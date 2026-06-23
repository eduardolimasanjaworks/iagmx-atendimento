import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import {
  obterConfigPainelEquipe,
  type BlocoEquipe,
} from './config-painel-equipe.js';
import { obterUsuarioPainel, type UsuarioPainel } from './painel-auth.js';

function chaveAdminValida(req: FastifyRequest): boolean {
  if (!config.adminKey) return false;
  return req.headers['x-iagmx-key'] === config.adminKey;
}

function adminPorChave(): UsuarioPainel {
  return {
    email: config.painelAdminEmail.toLowerCase(),
    perfil: 'admin',
    nome: 'Administrador GMX',
  };
}

export function obterUsuarioPainelOuChave(req: FastifyRequest): UsuarioPainel | null {
  const usuario = obterUsuarioPainel(req);
  if (usuario) return usuario;
  if (chaveAdminValida(req)) return adminPorChave();
  return null;
}

export function painelAutenticado(req: FastifyRequest): boolean {
  return Boolean(obterUsuarioPainelOuChave(req));
}

export function painelAdmin(req: FastifyRequest): boolean {
  return obterUsuarioPainelOuChave(req)?.perfil === 'admin';
}

export async function painelPodeVer(req: FastifyRequest, bloco: BlocoEquipe): Promise<boolean> {
  const usuario = obterUsuarioPainelOuChave(req);
  if (!usuario) return false;
  if (usuario.perfil === 'admin') return true;
  const cfg = await obterConfigPainelEquipe();
  return cfg.blocosVisiveis.includes(bloco);
}

export async function resumirAcessoPainel(req: FastifyRequest) {
  const usuario = obterUsuarioPainelOuChave(req);
  const configEquipe = await obterConfigPainelEquipe();
  return {
    autenticado: Boolean(usuario),
    usuario,
    equipe: {
      blocosVisiveis: configEquipe.blocosVisiveis,
    },
  };
}
