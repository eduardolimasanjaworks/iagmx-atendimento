import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export type PerfilPainel = 'admin' | 'equipe';

export interface UsuarioPainel {
  email: string;
  perfil: PerfilPainel;
  nome: string;
}

interface SessaoPainel {
  email: string;
  perfil: PerfilPainel;
  exp: number;
}

const COOKIE_SESSAO = 'iagmx_painel';
const SETE_DIAS_EM_SEGUNDOS = 7 * 24 * 60 * 60;

function usuariosPermitidos() {
  return [
    {
      email: config.painelAdminEmail.toLowerCase(),
      senha: config.painelAdminSenha,
      perfil: 'admin' as const,
      nome: 'Administrador GMX',
    },
    {
      email: config.painelEquipeEmail.toLowerCase(),
      senha: config.painelEquipeSenha,
      perfil: 'equipe' as const,
      nome: 'Equipe GMX',
    },
  ];
}

function base64UrlEncode(texto: string): string {
  return Buffer.from(texto, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(texto: string): string {
  const normalizado = texto.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalizado.length % 4 === 0 ? '' : '='.repeat(4 - (normalizado.length % 4));
  return Buffer.from(normalizado + padding, 'base64').toString('utf-8');
}

function assinar(payload: string): string {
  return createHmac('sha256', config.painelSessaoSecret).update(payload).digest('base64url');
}

function cookieParts(req: FastifyRequest): Record<string, string> {
  const bruto = req.headers.cookie || '';
  const itens = Array.isArray(bruto) ? bruto.join(';') : bruto;
  return itens.split(';').reduce<Record<string, string>>((acc, item) => {
    const [chave, ...resto] = item.trim().split('=');
    if (!chave) return acc;
    acc[chave] = decodeURIComponent(resto.join('=') || '');
    return acc;
  }, {});
}

function montarCookie(valor: string, maxAge = SETE_DIAS_EM_SEGUNDOS): string {
  const seguro = process.env.NODE_ENV !== 'development';
  return [
    `${COOKIE_SESSAO}=${encodeURIComponent(valor)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    seguro ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function limparCookie(): string {
  const seguro = process.env.NODE_ENV !== 'development';
  return [
    `${COOKIE_SESSAO}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    seguro ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function criarToken(sessao: SessaoPainel): string {
  const payload = base64UrlEncode(JSON.stringify(sessao));
  const assinatura = assinar(payload);
  return `${payload}.${assinatura}`;
}

function validarToken(token: string | null | undefined): UsuarioPainel | null {
  if (!token || !token.includes('.')) return null;
  const [payload, assinaturaRecebida] = token.split('.', 2);
  if (!payload || !assinaturaRecebida) return null;
  const assinaturaEsperada = assinar(payload);
  const a = Buffer.from(assinaturaRecebida);
  const b = Buffer.from(assinaturaEsperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const sessao = JSON.parse(base64UrlDecode(payload)) as SessaoPainel;
    if (!sessao.email || !sessao.perfil || !sessao.exp || Date.now() > sessao.exp) return null;
    const usuario = usuariosPermitidos().find(
      (item) => item.email === String(sessao.email).toLowerCase() && item.perfil === sessao.perfil,
    );
    if (!usuario) return null;
    return { email: usuario.email, perfil: usuario.perfil, nome: usuario.nome };
  } catch {
    return null;
  }
}

export function autenticarCredenciais(email: string, senha: string): UsuarioPainel | null {
  const usuario = usuariosPermitidos().find(
    (item) => item.email === email.trim().toLowerCase() && item.senha === senha,
  );
  if (!usuario) return null;
  return { email: usuario.email, perfil: usuario.perfil, nome: usuario.nome };
}

export function iniciarSessaoPainel(reply: FastifyReply, usuario: UsuarioPainel): void {
  const token = criarToken({
    email: usuario.email,
    perfil: usuario.perfil,
    exp: Date.now() + SETE_DIAS_EM_SEGUNDOS * 1000,
  });
  reply.header('Set-Cookie', montarCookie(token));
}

export function encerrarSessaoPainel(reply: FastifyReply): void {
  reply.header('Set-Cookie', limparCookie());
}

export function obterUsuarioPainel(req: FastifyRequest): UsuarioPainel | null {
  const cookies = cookieParts(req);
  return validarToken(cookies[COOKIE_SESSAO]);
}

export function usuarioEhAdmin(req: FastifyRequest): boolean {
  return obterUsuarioPainel(req)?.perfil === 'admin';
}

export function garantirUsuarioPainel(req: FastifyRequest): UsuarioPainel {
  const usuario = obterUsuarioPainel(req);
  if (!usuario) throw new Error('Não autenticado');
  return usuario;
}

export function cookieSessaoNome(): string {
  return COOKIE_SESSAO;
}
