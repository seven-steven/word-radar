import { defineConfig } from "vitest/config";

// 独立测试配置：vitest 优先读 vitest.config.ts 而非 vite.config.ts，
// 避免测试时加载 @crxjs/vite-plugin（它只属于构建链路）。
export default defineConfig({
  test: {
    // 默认 node 环境；DOM 提取测试在文件内用 @vitest-environment jsdom 声明。
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
