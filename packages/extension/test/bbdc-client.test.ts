/**
 * BbdcClient 单测：注入 mock fetch 覆盖 6 个端点的 URL 构造、FormData 字段、
 * result_code 判断、BbdcAuthError 触发条件，以及「不手动设 Content-Type」契约。
 *
 * 核心契约（来自 spec §不背单词对接）：
 * - check-login: result_code 200 = 已登录；非 200 抛 BbdcAuthError
 * - addWord: FormData 字段 newwordlist = JSON 串，**禁止**手动设 Content-Type
 * - removeWords: FormData 字段 newwordlist = 逗号分隔词串
 * - 全部请求带 credentials: "include"
 * - 401/403 抛 BbdcAuthError
 */
import { describe, expect, it, vi } from "vitest";
import {
  BbdcApiError,
  BbdcAuthError,
  BbdcHttpError,
  createBbdcClient,
  type BbdcClient,
} from "../src/lib/bbdc-client.js";

/** 构造一个返回固定 status+body 的 Response（fetch API 兼容最小面）。 */
function makeResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 把传进来的 init.body（FormData / string）转成可断言的形状。 */
async function normalizeBody(body: BodyInit | undefined): Promise<{
  isFormData: boolean;
  fields: Record<string, string>;
}> {
  if (body instanceof FormData) {
    const fields: Record<string, string> = {};
    for (const [key, value] of body.entries()) {
      fields[key] = typeof value === "string" ? value : "[non-string]";
    }
    return { isFormData: true, fields };
  }
  return { isFormData: false, fields: {} };
}

function makeClient(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  );
  const client = createBbdcClient({ fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

describe("BbdcClient.checkLogin", () => {
  it("向 https://bbdc.cn/api/check-login 发 GET，带 credentials:include", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { result_code: 200 }));

    const result = await client.checkLogin();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bbdc.cn/api/check-login");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(result).toEqual({ loggedIn: true, resultCode: 200 });
  });

  it("HTTP 401 抛 BbdcAuthError(kind=http, status=401)", async () => {
    const { client } = makeClient(() => makeResponse(401, { msg: "未登录" }));

    await expect(client.checkLogin()).rejects.toBeInstanceOf(BbdcAuthError);
    await expect(client.checkLogin()).rejects.toMatchObject({
      kind: "http",
      status: 401,
    });
  });

  it("HTTP 403 抛 BbdcAuthError(kind=http, status=403)", async () => {
    const { client } = makeClient(() => makeResponse(403, { msg: "forbidden" }));

    await expect(client.checkLogin()).rejects.toMatchObject({
      kind: "http",
      status: 403,
    });
  });

  it("result_code 非 200 抛 BbdcAuthError(kind=check-login)", async () => {
    const { client } = makeClient(() => makeResponse(200, { result_code: 401 }));

    await expect(client.checkLogin()).rejects.toBeInstanceOf(BbdcAuthError);
    await expect(client.checkLogin()).rejects.toMatchObject({
      kind: "check-login",
      resultCode: 401,
    });
  });

  it("响应不是 JSON 抛普通 Error，不归为鉴权失败", async () => {
    const { client } = makeClient(() => new Response("not json", { status: 500 }));

    await expect(client.checkLogin()).rejects.toBeInstanceOf(Error);
    await expect(client.checkLogin()).rejects.not.toBeInstanceOf(BbdcAuthError);
  });
});

describe("BbdcClient.lookupDefinition", () => {
  it("向 langeasy.com.cn/loadLexisList.action 发 GET，word URL 编码", async () => {
    const { client, fetchMock } = makeClient(() =>
      makeResponse(200, {
        wordlist: [{ interpret: "n. 试金石；标准" }],
      }),
    );

    const result = await client.lookupDefinition("a b/c");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://langeasy.com.cn/loadLexisList.action?strict=1&word=a%20b%2Fc");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(result).toEqual({ interpret: "n. 试金石；标准" });
  });

  it("wordlist 空数组时返回 null", async () => {
    const { client } = makeClient(() => makeResponse(200, { wordlist: [] }));

    expect(await client.lookupDefinition("nonexistent")).toBeNull();
  });

  it("wordlist 缺字段时返回 null", async () => {
    const { client } = makeClient(() => makeResponse(200, {}));

    expect(await client.lookupDefinition("any")).toBeNull();
  });

  it("HTTP 401 抛 BbdcAuthError", async () => {
    const { client } = makeClient(() => makeResponse(401, {}));

    await expect(client.lookupDefinition("x")).rejects.toBeInstanceOf(BbdcAuthError);
  });
});

describe("BbdcClient.checkExisting", () => {
  it("URL 含 word（URL 编码）+ infoidx=100", async () => {
    const { client, fetchMock } = makeClient(() =>
      makeResponse(200, { data_body: { list: [{ word: "run" }] } }),
    );

    const result = await client.checkExisting("run");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bbdc.cn/api/check-new-word?word=run&infoidx=100");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(result).toEqual({ exists: true });
  });

  it("word 含空格/中文时正确 URL 编码", async () => {
    const { client, fetchMock } = makeClient(() =>
      makeResponse(200, { data_body: { list: [] } }),
    );

    await client.checkExisting("汉 a");

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://bbdc.cn/api/check-new-word?word=%E6%B1%89%20a&infoidx=100",
    );
  });

  it("data_body.list 非空 → exists:true", async () => {
    const { client } = makeClient(() =>
      makeResponse(200, { data_body: { list: [{ word: "run", updatetime: 1 }] } }),
    );

    expect(await client.checkExisting("run")).toEqual({ exists: true });
  });

  it("data_body.list 空数组 → exists:false", async () => {
    const { client } = makeClient(() => makeResponse(200, { data_body: { list: [] } }));

    expect(await client.checkExisting("run")).toEqual({ exists: false });
  });

  it("data_body 缺 list → exists:false", async () => {
    const { client } = makeClient(() => makeResponse(200, { data_body: {} }));

    expect(await client.checkExisting("run")).toEqual({ exists: false });
  });

  it("HTTP 403 抛 BbdcAuthError", async () => {
    const { client } = makeClient(() => makeResponse(403, {}));

    await expect(client.checkExisting("x")).rejects.toMatchObject({
      kind: "http",
      status: 403,
    });
  });
});

describe("BbdcClient.addWord（关键契约：不手动设 Content-Type）", () => {
  it("FormData 字段 newwordlist 为 JSON 串（对象非数组），含官方插件全部字段", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { result_code: 200 }));

    await client.addWord("serendipity", "n. 意外发现珍宝的运气");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bbdc.cn/api/user-new-word");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const { isFormData, fields } = await normalizeBody(init.body);
    expect(isFormData).toBe(true);
    const parsed = JSON.parse(fields.newwordlist);
    // 官方查词插件（v1.2.1）形态：JSON.stringify(对象)；数组会触发 BBDC
    // exception_handler → result_code 20000「未知错误」。
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed).toEqual({
      word: "serendipity",
      info: "n. 意外发现珍宝的运气",
      course: "*",
      wordidx: "*",
      infoidx: "100",
      selection: "*",
      opcode: "1",
    });
  });

  it("**不**手动设置 Content-Type（spec 硬要求：让浏览器带 boundary）", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { result_code: 200 }));

    await client.addWord("run", "v. 跑");

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
  });

  it("result_code 200 视为成功", async () => {
    const { client } = makeClient(() => makeResponse(200, { result_code: 200 }));

    await expect(client.addWord("run", "v. 跑")).resolves.toBeUndefined();
  });

  it("result_code 非 200 抛 BbdcApiError（非鉴权错）", async () => {
    const { client } = makeClient(() => makeResponse(200, { result_code: 500 }));

    await expect(client.addWord("run", "v. 跑")).rejects.toBeInstanceOf(BbdcApiError);
    await expect(client.addWord("run", "v. 跑")).rejects.toMatchObject({
      resultCode: 500,
    });
  });

  it("HTTP 401 抛 BbdcAuthError（鉴权优先于 result_code 判断）", async () => {
    const { client } = makeClient(() => makeResponse(401, {}));

    await expect(client.addWord("run", "v. 跑")).rejects.toBeInstanceOf(BbdcAuthError);
  });
});

describe("BbdcClient.listNewWords", () => {
  it("URL 含 page=N", async () => {
    const { client, fetchMock } = makeClient(() =>
      makeResponse(200, {
        result_code: 200,
        data_body: { list: [{ word: "a" }, { word: "b" }] },
      }),
    );

    const body = await client.listNewWords(3);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://bbdc.cn/api/user-new-word?page=3",
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("GET");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe("include");
    expect(body.data_body?.list).toEqual([{ word: "a" }, { word: "b" }]);
  });

  it("page=0 仍正确编码", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { data_body: { list: [] } }));

    await client.listNewWords(0);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://bbdc.cn/api/user-new-word?page=0");
  });

  it("HTTP 401 抛 BbdcAuthError", async () => {
    const { client } = makeClient(() => makeResponse(401, {}));

    await expect(client.listNewWords(1)).rejects.toBeInstanceOf(BbdcAuthError);
  });
});

describe("BbdcClient.removeWords", () => {
  it("FormData 字段 newwordlist 为逗号分隔词串", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { result_code: 200 }));

    await client.removeWords(["run", "garden", "serendipity"]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bbdc.cn/api/remove-user-new-word");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).credentials).toBe("include");
    const { isFormData, fields } = await normalizeBody((init as RequestInit).body);
    expect(isFormData).toBe(true);
    expect(fields.newwordlist).toBe("run,garden,serendipity");
  });

  it("不手动设 Content-Type", async () => {
    const { client, fetchMock } = makeClient(() => makeResponse(200, { result_code: 200 }));

    await client.removeWords(["run"]);

    const headers = ((fetchMock.mock.calls[0]![1] as RequestInit).headers ?? {}) as Record<
      string,
      string
    >;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("result_code 200 视为成功；非 200 抛 BbdcApiError", async () => {
    const ok = makeClient(() => makeResponse(200, { result_code: 200 }));
    await expect(ok.client.removeWords(["run"])).resolves.toBeUndefined();

    const fail = makeClient(() => makeResponse(200, { result_code: 999 }));
    await expect(fail.client.removeWords(["run"])).rejects.toBeInstanceOf(BbdcApiError);
  });

  it("HTTP 403 抛 BbdcAuthError", async () => {
    const { client } = makeClient(() => makeResponse(403, {}));

    await expect(client.removeWords(["x"])).rejects.toMatchObject({
      kind: "http",
      status: 403,
    });
  });
});

describe("BbdcClient 工厂默认 fetch", () => {
  it("不注入 fetch 时使用全局 fetch", () => {
    // 把全局 fetch 替换成 vi.fn()，确认 createBbdcClient() 不注入也跑通
    const spy = vi.fn(async () => makeResponse(200, { result_code: 200 }));
    const original = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const client: BbdcClient = createBbdcClient();
      void client.checkLogin();
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
describe("BbdcClient 非 2xx HTTP 状态分流", () => {
  it("HTTP 404 抛 BbdcHttpError，携带 status=404", async () => {
    const { client } = makeClient(() => makeResponse(404, { result_code: 404 }));

    await expect(client.checkLogin()).rejects.toBeInstanceOf(BbdcHttpError);
    await expect(client.checkLogin()).rejects.toMatchObject({ status: 404 });
  });

  it("HTTP 429 抛 BbdcHttpError，携带 status=429", async () => {
    const { client } = makeClient(() => makeResponse(429, "too many"));

    await expect(client.addWord("run", "v. 跑")).rejects.toBeInstanceOf(BbdcHttpError);
    await expect(client.addWord("run", "v. 跑")).rejects.toMatchObject({ status: 429 });
  });

  it("HTTP 500 抛 BbdcHttpError（非鉴权错），携带 status=500", async () => {
    const { client } = makeClient(() => makeResponse(500, "boom"));

    await expect(client.checkExisting("run")).rejects.toBeInstanceOf(BbdcHttpError);
    await expect(client.checkExisting("run")).rejects.not.toBeInstanceOf(BbdcAuthError);
    await expect(client.checkExisting("run")).rejects.toMatchObject({ status: 500 });
  });

  it("HTTP 401 仍抛 BbdcAuthError（不是 BbdcHttpError）", async () => {
    const { client } = makeClient(() => makeResponse(401, "unauthorized"));

    await expect(client.checkLogin()).rejects.toBeInstanceOf(BbdcAuthError);
    await expect(client.checkLogin()).rejects.not.toBeInstanceOf(BbdcHttpError);
  });
});
