import { searchMate, type MateResult } from "./solver";

export type SearchRequest = {
  type: "search";
  sfen: string;
  maxPlies: number;
  timeLimitMs: number;
};

export type SearchResponse = {
  type: "result";
  result: MateResult;
};

const ctx = self as unknown as {
  postMessage: (message: SearchResponse) => void;
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const req = event.data;
  if (req.type !== "search") return;
  try {
    const result = searchMate(req.sfen, {
      maxPlies: req.maxPlies,
      timeLimitMs: req.timeLimitMs,
    });
    ctx.postMessage({ type: "result", result });
  } catch (e) {
    ctx.postMessage({
      type: "result",
      result: {
        status: "timeout",
        nodes: 0,
        elapsedMs: 0,
      },
    });
    // エラー内容はコンソールに残す（UI上は不明として扱う）
    console.error(e);
  }
};
