/**
 * 最小 Pi 扩展示例：在 system prompt 末尾追加自定义指令。
 *
 * 通过 before_agent_start 事件拦截系统提示词，
 * 保留原生 system prompt 并在其后追加额外内容。
 */

export default function extraPromptExtension(pi, logger) {
  pi.on("before_agent_start", async (event) => {
    logger?.info("extra-prompt", `before_agent_start fired, prompt ${event.systemPrompt}`);

    return {
      systemPrompt: event.systemPrompt
    };
  });
}
