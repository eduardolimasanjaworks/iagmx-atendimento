/**
 * Persistencia de arquivo original e sugestao OCR pendente no Directus GMX.
 * Evita sobrescrita automatica: a IA apenas sugere e a equipe decide aplicar.
 * Mantem o asset original acessivel no card do motorista para consulta e exclusao.
 */
import { directusAssetUrl, directusPost, directusUploadArquivo } from './directus.js';
import type { MidiaCacheada } from './midia-cache.js';

export interface RegistrarOcrPendenteInput {
  motoristaId: number | string;
  telefone: string;
  tipoDocumento: string;
  colecaoDestino: string | null;
  midia: MidiaCacheada;
  textoExtraido?: string;
  camposExtraidos?: Record<string, unknown>;
  sugestaoDocumento?: Record<string, unknown>;
  sugestaoMotorista?: Record<string, unknown>;
}

export interface RegistroOcrPendenteResultado {
  fileId: string;
  fileUrl: string;
  colecao: string;
  registroId: number | string;
  arquivoOriginalId: number | string;
  sugestaoId: number | string;
  pendente: true;
}

function jsonSeguro(valor: unknown): string {
  try {
    return JSON.stringify(valor ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

export async function registrarOcrPendenteGmx(
  input: RegistrarOcrPendenteInput,
): Promise<RegistroOcrPendenteResultado> {
  const fileId = await directusUploadArquivo(
    input.midia.buffer,
    input.midia.fileName,
    input.midia.mimetype,
  );
  const fileUrl = directusAssetUrl(fileId);
  const colecao = input.colecaoDestino || 'pendente_sem_destino';

  const arquivoOriginal = await directusPost<{ id: number | string }>('motorista_arquivo_original', {
    motorista_id: String(input.motoristaId),
    telefone: input.telefone,
    tipo_documento: input.tipoDocumento,
    origem: 'whatsapp_ia',
    nome_arquivo: input.midia.fileName,
    mime_type: input.midia.mimetype,
    tamanho_bytes: input.midia.buffer.length,
    asset_id: fileId,
    link: fileUrl,
    midia_id: input.midia.midiaId || null,
    texto_ocr: input.textoExtraido || null,
    campos_extraidos: jsonSeguro(input.camposExtraidos),
    status: 'recebido',
  });

  const sugestao = await directusPost<{ id: number | string }>('motorista_ocr_sugestao', {
    motorista_id: String(input.motoristaId),
    telefone: input.telefone,
    tipo_documento: input.tipoDocumento,
    colecao_destino: colecao,
    arquivo_original_id: arquivoOriginal.id,
    asset_id: fileId,
    link: fileUrl,
    status: 'pendente',
    sugestao_documento: jsonSeguro(input.sugestaoDocumento),
    sugestao_motorista: jsonSeguro(input.sugestaoMotorista),
    campos_extraidos: jsonSeguro(input.camposExtraidos),
    texto_ocr: input.textoExtraido || null,
    observacao:
      'Sugestao criada pela IA a partir de arquivo original do WhatsApp. Aplique manualmente no card do motorista.',
  });

  return {
    fileId,
    fileUrl,
    colecao,
    registroId: sugestao.id,
    arquivoOriginalId: arquivoOriginal.id,
    sugestaoId: sugestao.id,
    pendente: true,
  };
}
