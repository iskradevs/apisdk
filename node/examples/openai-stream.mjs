import { iskra } from "./config.mjs";
for await (const chunk of iskra.openai.chatCompletions({
  model: "iskra-agent",
  messages: [{ role: "user", content: "Объясни, как составить план проекта." }],
  stream: true,
})) {
  if ("error" in chunk) {
    console.error(chunk.error);
    break;
  }
  for (const choice of chunk.choices ?? []) process.stdout.write(choice.delta?.content ?? "");
}
process.stdout.write("\n");
