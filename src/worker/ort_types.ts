export interface OrtTensor {
  data: Float32Array
}

export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

export interface OrtLike {
  Tensor: new (kind: string, data: Float32Array, dims: number[]) => OrtTensor
  InferenceSession: {
    create(
      src: Uint8Array | string,
      opts?: Record<string, unknown>,
    ): Promise<OrtSession>
  }
  env: { wasm: { wasmPaths: string; numThreads: number } }
}
