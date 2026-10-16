/**
 * The grey [BOT] after a bot's name. It takes the name's font, size and weight, but not its color,
 * and sits inside the element the name is in, so shrinking or cutting the name off counts it too.
 */
export function BotTag() {
  return <span className="bot-tag">[BOT]</span>;
}
