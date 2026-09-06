/**
 * Arquivo de verificação da Etapa 0.
 * Serve apenas para confirmar que o TypeScript compila (src/ -> dist/) e roda no Node.
 * Será substituído pelos módulos reais a partir da Etapa 1.
 */

// Tipo explícito: exercita a tipagem estática rigorosa configurada no tsconfig.json.
interface AmbienteProjeto {
  readonly projeto: string;
  readonly etapa: number;
  readonly versaoNode: string;
}

function descreverAmbiente(ambiente: AmbienteProjeto): string {
  return `${ambiente.projeto} | Etapa ${ambiente.etapa} | Node ${ambiente.versaoNode}`;
}

const ambiente: AmbienteProjeto = {
  projeto: "CyberGuardian Node",
  etapa: 0,
  versaoNode: process.version,
};

console.log("[setup] TypeScript compilou e o Node executou com sucesso.");
console.log(`[setup] ${descreverAmbiente(ambiente)}`);
