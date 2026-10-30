import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";

// Only used in the disposable test image. Trust a short-lived local CA in its
// own user profile; never disable certificate or hostname verification.
export async function testTls(upstreamPort: number, directory: string) {
  if (process.env.REELCHEMY_CONTAINER_TESTS !== "1")
    throw new Error(
      "Production HTTPS browser checks require the disposable test container profile.",
    );
  const dir = path.join(directory, "tls");
  await mkdir(dir, { mode: 0o700 });
  const caFile = path.join(dir, "ca.crt"),
    caKey = path.join(dir, "ca.key"),
    keyFile = path.join(dir, "server.key"),
    certFile = path.join(dir, "server.crt"),
    csr = path.join(dir, "server.csr"),
    extensions = path.join(dir, "extensions.cnf");
  function run(command: string, args: string[]) {
    execFileSync(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 20000,
    });
  }
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-noenc",
    "-keyout",
    caKey,
    "-out",
    caFile,
    "-subj",
    "/CN=Reelchemy isolated test CA",
    "-days",
    "1",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  run("openssl", [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-noenc",
    "-keyout",
    keyFile,
    "-out",
    csr,
    "-subj",
    "/CN=127.0.0.1",
  ]);
  await chmod(caKey, 0o600);
  await chmod(keyFile, 0o600);
  await writeFile(
    extensions,
    "subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
    { mode: 0o600 },
  );
  run("openssl", [
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    caFile,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    certFile,
    "-days",
    "1",
    "-extfile",
    extensions,
    "-sha256",
  ]);
  run("openssl", ["verify", "-CAfile", caFile, certFile]);
  const stores = [
    path.join(homedir(), ".pki/nssdb"),
    path.join(homedir(), ".local/share/pki/nssdb"),
  ];
  const label = `Reelchemy-${path.basename(directory)}`;
  for (const nss of stores) {
    await mkdir(nss, { recursive: true, mode: 0o700 });
    try {
      await access(path.join(nss, "cert9.db"));
    } catch {
      run("certutil", ["-N", "-d", `sql:${nss}`, "--empty-password"]);
    }
    run("certutil", [
      "-A",
      "-d",
      `sql:${nss}`,
      "-n",
      label,
      "-t",
      "C,,",
      "-i",
      caFile,
    ]);
  }
  const ca = await readFile(caFile),
    agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
  const server = https.createServer(
    { key: await readFile(keyFile), cert: await readFile(certFile) },
    (req, res) => {
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: upstreamPort,
          path: req.url,
          method: req.method,
          agent,
          headers: {
            ...req.headers,
            "x-forwarded-proto": "https",
            "x-forwarded-host": req.headers.host,
          },
        },
        (incoming) => {
          res.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    },
  );
  const close = async () => {
    agent.destroy();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const nss of stores)
      run("certutil", ["-D", "-d", `sql:${nss}`, "-n", label]);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    await close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("HTTPS test proxy has no TCP address.");
  const origin = `https://127.0.0.1:${address.port}`;
  const untrustedRejected = await new Promise<boolean>((resolve) => {
    const request = https.get(
      origin,
      { ca: [], rejectUnauthorized: true, timeout: 5000 },
      (response) => {
        response.resume();
        resolve(false);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", (error: NodeJS.ErrnoException) =>
      resolve(
        [
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "SELF_SIGNED_CERT_IN_CHAIN",
          "DEPTH_ZERO_SELF_SIGNED_CERT",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        ].includes(error.code || ""),
      ),
    );
  });
  if (!untrustedRejected) {
    await close();
    throw new Error(
      "The production test proxy did not reject an untrusted certificate chain.",
    );
  }

  return {
    origin,
    caFile,
    status: (pathname: string) =>
      new Promise<number>((resolve, reject) => {
        const request = https.get(
          `${origin}${pathname}`,
          { ca, timeout: 5000 },
          (response) => {
            response.resume();
            resolve(response.statusCode || 0);
          },
        );
        request.on("timeout", () =>
          request.destroy(new Error("HTTPS test readiness timed out.")),
        );
        request.on("error", reject);
      }),
    close,
  };
}
