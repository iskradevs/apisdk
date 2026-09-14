import { iskra } from "./config.mjs";
const response = await iskra.chat.create({ message: "Кратко расскажи, чем можешь помочь." });
console.log(response.answer ?? response.interaction);
await iskra.chat.delete(response.conversation_id);
