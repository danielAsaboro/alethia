export const QVAC_MODEL_ALIAS = "sourcetruce-extractor";
export const QVAC_MODEL_SOURCE = ".local/models/Qwen3.8-27B-UD-Q4_K_XL.gguf";
export const QVAC_MODEL_DOWNLOAD_URL =
  "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/27af057ecb382ddfea5d12837360a8980560e3ed/Qwen3.8-27B-UD-Q4_K_XL.gguf";
export const QVAC_MODEL_SHA256 =
  "3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e";
export const QVAC_MODEL_EXPECTED_BYTES = 17_559_178_144;

export interface QvacRuntimeModel {
  alias: string;
  modelSource: string | null;
  downloadUrl: string | null;
  modelSha256: string | null;
  expectedBytes: number | null;
  displayName: string;
  parameters: string | null;
  quantization: string | null;
}

export function qvacRuntimeModel(alias: string): QvacRuntimeModel {
  if (alias === QVAC_MODEL_ALIAS) {
    return {
      alias,
      modelSource: QVAC_MODEL_SOURCE,
      downloadUrl: QVAC_MODEL_DOWNLOAD_URL,
      modelSha256: QVAC_MODEL_SHA256,
      expectedBytes: QVAC_MODEL_EXPECTED_BYTES,
      displayName: "Qwen3.8 27B UD-Q4_K_XL",
      parameters: "27B",
      quantization: "UD-Q4_K_XL",
    };
  }
  return {
    alias,
    modelSource: null,
    downloadUrl: null,
    modelSha256: null,
    expectedBytes: null,
    displayName: `Custom QVAC model (${alias})`,
    parameters: null,
    quantization: null,
  };
}
