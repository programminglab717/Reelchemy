import { z } from "zod";
import { RequestRateError } from "@/lib/limits-policy";
import {
  motionExampleMarkup,
  motionExamples,
  motionGuide,
} from "@/director/prompts";
import { tools, ToolError, type McpContext, type ToolResult } from "./tools";
import packageJson from "../../package.json";

// A Model Context Protocol server (Streamable HTTP, stateless JSON
// responses): tools, the motion guide and reference scenes as resources, and
// a prompt that sets an assistant up to make a film.
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };

const INSTRUCTIONS = `Reelchemy is a motion-graphics video studio: films are made of code scenes (HTML, CSS and GSAP JavaScript with Reelchemy's motion kit) rendered frame by frame to MP4. Start with get_motion_guide, plan the film, then create_project and write_scene for each scene; read every preview's stills and automatic checks and revise until they pass; finish with export_video.`;

const resources = [
  {
    uri: "reelchemy://guide/motion",
    name: "motion-guide",
    title: "Reelchemy motion guide",
    description:
      "Runtime contract, motion kit reference and design standards for code scenes.",
    mimeType: "text/markdown",
    read: () => motionGuide(),
  },
  ...Object.entries(motionExamples).map(([key, example]) => ({
    uri: `reelchemy://examples/${key}`,
    name: `example-${key}`,
    title: example.title,
    description: `Reference scene (${example.format}, ${example.seconds} s).`,
    mimeType: "text/plain",
    read: () =>
      `Reference scene: ${example.title} (${example.format}, ${example.seconds} s). Pass html, css, js and libraries to write_scene.\n\n${motionExampleMarkup(example.code)}`,
  })),
];

const prompts = [
  {
    name: "make_explainer",
    title: "Make an explainer video",
    description:
      "Plan and animate a motion-graphics explainer in the studio, scene by scene, checking each one.",
    arguments: [
      {
        name: "topic",
        description: "What the video explains.",
        required: true,
      },
      {
        name: "seconds",
        description: "Length in seconds (default 30).",
        required: false,
      },
      {
        name: "format",
        description: "landscape, portrait or square (default landscape).",
        required: false,
      },
    ],
    get: (args: Record<string, string>) =>
      `Make a ${args.seconds || 30}-second ${args.format || "landscape"} motion-graphics explainer in Reelchemy about: ${args.topic}.\n\n1. Call get_motion_guide (and read one or two reference resources).\n2. Plan: the story (hook → step-by-step explanation → payoff), one style guide for the whole film, and for each scene its shots (2–4 per scene over ~6 s, joined by transitions) with a new visual event every 1.5–2 s.\n3. create_project, then write_scene for each scene. Study each preview: fix every automatic finding and anything that looks like a slide rather than motion design.\n4. When every scene passes, export_video and report the export_status.`,
  },
];

function toolList() {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
    annotations: {
      title: t.title,
      readOnlyHint: !!t.readOnly,
      destructiveHint: !!t.destructive,
      openWorldHint: false,
    },
  }));
}

async function callTool(
  name: string,
  args: unknown,
  ctx: McpContext,
): Promise<ToolResult> {
  const definition = tools.find((t) => t.name === name);
  if (!definition) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const parsed = definition.input.safeParse(args ?? {});
  if (!parsed.success)
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
        },
      ],
    };
  try {
    return await definition.run(parsed.data, ctx);
  } catch (error) {
    // Tool failures are results the model can act on, not protocol errors.
    const message =
      error instanceof ToolError ||
      error instanceof RequestRateError ||
      error instanceof z.ZodError
        ? error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : error.message
        : error instanceof Error &&
            /not found|limit|revision|refused/i.test(error.message)
          ? error.message
          : "The studio could not complete this tool call.";
    if (!(error instanceof ToolError || error instanceof RequestRateError))
      console.error("MCP tool failed", name, error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

async function dispatch(
  message: JsonRpcRequest,
  ctx: McpContext,
): Promise<unknown> {
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      return {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : MCP_PROTOCOL_VERSIONS[0],
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: "reelchemy",
          title: "Reelchemy",
          version: packageJson.version,
        },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolList() };
    case "tools/call":
      return callTool(String(params.name ?? ""), params.arguments, ctx);
    case "resources/list":
      return {
        resources: resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          title: r.title,
          description: r.description,
          mimeType: r.mimeType,
        })),
      };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const resource = resources.find((r) => r.uri === params.uri);
      if (!resource)
        throw new RpcError(-32002, `Resource not found: ${params.uri}`);
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.read(),
          },
        ],
      };
    }
    case "prompts/list":
      return {
        prompts: prompts.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.arguments,
        })),
      };
    case "prompts/get": {
      const prompt = prompts.find((p) => p.name === params.name);
      if (!prompt) throw new RpcError(-32602, `Unknown prompt: ${params.name}`);
      const args = (params.arguments ?? {}) as Record<string, string>;
      if (!args.topic)
        throw new RpcError(-32602, "The topic argument is required.");
      return {
        description: prompt.description,
        messages: [
          { role: "user", content: { type: "text", text: prompt.get(args) } },
        ],
      };
    }
    default:
      throw new RpcError(-32601, `Method not found: ${message.method}`);
  }
}

// Handles one JSON-RPC message (or a batch). Notifications get no reply.
export async function handleMcpMessage(
  payload: unknown,
  ctx: McpContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    const replies = (
      await Promise.all(payload.map((m) => handleMcpMessage(m, ctx)))
    ).filter((r): r is JsonRpcResponse => r !== null);
    return replies.length ? replies : null;
  }
  const message = payload as JsonRpcRequest;
  if (
    !message ||
    typeof message !== "object" ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  )
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid JSON-RPC request." },
    };
  const isNotification = message.id === undefined;
  if (isNotification) return null;
  try {
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: await dispatch(message, ctx),
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error:
        error instanceof RpcError
          ? { code: error.code, message: error.message }
          : { code: -32603, message: "Internal error." },
    };
  }
}
