import { iskra } from "./config.mjs";
const directory = await iskra.memory.createRoot({ name: "Материалы интеграции" });
const uploaded = await iskra.memory.upload({
  directory_id: directory.id,
  file: {
    name: "brief.txt",
    data: new Blob(["Тема исследования: качество процессов."], { type: "text/plain" }),
  },
});
const conversation = await iskra.conversations.create({
  memory_refs: [{ locator: { directory_id: directory.id }, access_mode: "read" }],
});
try {
  console.log(await iskra.conversations.context(conversation.conversation_id));
  const result = await iskra.chat.create({
    conversation_id: conversation.conversation_id,
    message: "Составь план по подключённым материалам.",
  });
  console.log(result.answer);
  const content = await iskra.memory.download(uploaded.file.id, { directory_id: directory.id });
  console.log(await content.text());
} finally {
  await iskra.chat.delete(conversation.conversation_id);
}
// Memory remains after the ephemeral conversation is deleted.
