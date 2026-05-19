export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(
    {
      ok: true,
      data
    } satisfies ApiSuccess<T>,
    init
  );
}

export function jsonError(code: string, message: string, init?: ResponseInit): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message
      }
    } satisfies ApiFailure,
    init
  );
}
