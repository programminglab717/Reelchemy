import path from "node:path";
import { preparedRenderer } from "./prepared-renderer";

let developmentBundle: Promise<string> | undefined;
export function rendererBundle() {
  if (process.env.NODE_ENV === "production") return preparedRenderer();
  // Only development/test compiles at runtime. Production never imports the
  // compiler or writes its webpack cache into a renderer's bounded tmpfs.
  return (developmentBundle ??= import("@remotion/bundler")
    .then(({ bundle }) =>
      bundle({ entryPoint: path.resolve("src/video/index.tsx") }),
    )
    .catch((error) => {
      developmentBundle = undefined;
      throw error;
    }));
}
