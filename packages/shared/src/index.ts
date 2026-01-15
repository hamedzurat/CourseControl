export type RequestId = string;

export type RpcEnvelope<T> = {
  requestId: RequestId;
  type: string;
  payload: T;
};
