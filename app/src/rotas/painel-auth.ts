import type { FastifyInstance } from 'fastify';
import {
  BLOCOS_EQUIPE_DISPONIVEIS,
  CONFIG_PAINEL_EQUIPE_PADRAO,
  obterConfigPainelEquipe,
  salvarConfigPainelEquipe,
} from '../servicos/config-painel-equipe.js';
import {
  autenticarCredenciais,
  encerrarSessaoPainel,
  iniciarSessaoPainel,
} from '../servicos/painel-auth.js';
import {
  painelAdmin,
  painelAutenticado,
  resumirAcessoPainel,
} from '../servicos/painel-acesso.js';

export async function rotasPainelAuth(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; senha?: string } }>(
    '/api/painel/login',
    async (req, reply) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const senha = String(req.body?.senha ?? '');
      const usuario = autenticarCredenciais(email, senha);
      if (!usuario) {
        return reply.status(401).send({ erro: 'Login ou senha inválidos' });
      }
      iniciarSessaoPainel(reply, usuario);
      return {
        ok: true,
        usuario,
      };
    },
  );

  app.post('/api/painel/logout', async (_req, reply) => {
    encerrarSessaoPainel(reply);
    return { ok: true };
  });

  app.get('/api/painel/eu', async (req) => {
    if (!painelAutenticado(req)) {
      return {
        autenticado: false,
        usuario: null,
        equipe: {
          blocosVisiveis: [],
        },
      };
    }
    return resumirAcessoPainel(req);
  });

  app.get('/api/painel/visibilidade-equipe', async (req, reply) => {
    if (!painelAdmin(req)) {
      return reply.status(403).send({ erro: 'Apenas admin pode ver esta configuração' });
    }
    const configEquipe = await obterConfigPainelEquipe();
    return {
      opcoes: BLOCOS_EQUIPE_DISPONIVEIS,
      config: configEquipe,
      padrao: CONFIG_PAINEL_EQUIPE_PADRAO,
    };
  });

  app.put<{ Body: { blocosVisiveis?: string[] } }>(
    '/api/painel/visibilidade-equipe',
    async (req, reply) => {
      if (!painelAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode alterar esta configuração' });
      }
      const blocosVisiveis = Array.isArray(req.body?.blocosVisiveis)
        ? req.body?.blocosVisiveis
        : [];
      const salvo = await salvarConfigPainelEquipe(
        { blocosVisiveis: blocosVisiveis as never[] },
        'painel_admin',
      );
      return {
        ok: true,
        config: salvo,
      };
    },
  );
}
