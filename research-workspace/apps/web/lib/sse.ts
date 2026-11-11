/** Minimal server-sent-events parser for fetch streams (EventSource can't send an Authorization header). */
export interface SseFrame { event: string; data: string; id?: string }

export class SseParser {
  private buf = "";
  push(chunk: string): SseFrame[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: SseFrame[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = "message", id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;           // comment / keep-alive
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        const val = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = val; else if (field === "data") data.push(val); else if (field === "id") id = val;
      }
      if (data.length || event !== "message") out.push({ event, data: data.join("\n"), id });
    }
    return out;
  }
}
