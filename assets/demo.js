// "@modelcontextprotocol/sdk": "^1.25.1",
// "express": "^5.2.1",
import { z } from "zod";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// 1. 初始化 MCP Server
const server = new McpServer(
  {
    name: "simple-http-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // 声明拥有工具能力
    },
  }
);

// 2. 注册一个简单的工具 (Tool)
server.registerTool(
  "hello",
  {
    title: "问候指令",
    description: "一个简单的问候指令案例",
    inputSchema: {
      name: z.string().describe("被问候人名"),
    },
  },
  async ({ name }) => {
    return {
      content: [
        {
          type: "text",
          text: `👋你好, ${name}!`,
        },
      ],
    };
  }
);

// 3. 设置 Express 路由
const app = express();
app.use(express.json());

// 4. 设置 MCP 路由
let transports = {};
app.post("/mcp", async (req, res) => {
  const originalJson = res.json;
  res.json = function (body) {
    return originalJson.call(this, body);
  };

  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        eventStore,
        onsessioninitialized: (sessionId) => {
          console.log(`Session initialized: ${sessionId}`);
          transports[sessionId] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`MCP HTTP Server running at http://localhost:${PORT}/mcp`);
});
