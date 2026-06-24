import { directusConfigurado, directusListar, directusPatch, directusPost } from './directus.js';
import { registrarDisponibilidade } from './motorista-gmx.js';
import { normalizarTelefone } from '../util/telefone.js';

type CidadeBase = { cidade: string; uf: string; lat: number; lng: number };
type MotoristaSim = { id: number; telefone: string; nome: string; sobrenome: string };

export const TAG_SIMULACAO_MOTORISTAS = '__GMX_SIMULACAO_NAO_ENVIAR__MOTORISTAS__V2__';
export const TAG_SIMULACAO_EMBARQUES = '__GMX_SIMULACAO_NAO_ENVIAR__EMBARQUES__V2__';
const CIDADES: CidadeBase[] = [{ cidade: 'Guarulhos', uf: 'SP', lat: -23.4543, lng: -46.5337 }, { cidade: 'Campinas', uf: 'SP', lat: -22.9099, lng: -47.0626 }, { cidade: 'São Paulo', uf: 'SP', lat: -23.5505, lng: -46.6333 }, { cidade: 'Rio de Janeiro', uf: 'RJ', lat: -22.9068, lng: -43.1729 }, { cidade: 'Belo Horizonte', uf: 'MG', lat: -19.9167, lng: -43.9345 }, { cidade: 'Curitiba', uf: 'PR', lat: -25.4284, lng: -49.2733 }, { cidade: 'Porto Alegre', uf: 'RS', lat: -30.0346, lng: -51.2177 }, { cidade: 'Goiânia', uf: 'GO', lat: -16.6869, lng: -49.2648 }, { cidade: 'Brasília', uf: 'DF', lat: -15.7939, lng: -47.8828 }, { cidade: 'Salvador', uf: 'BA', lat: -12.9777, lng: -38.5016 }, { cidade: 'Recife', uf: 'PE', lat: -8.0578, lng: -34.8829 }, { cidade: 'Fortaleza', uf: 'CE', lat: -3.7319, lng: -38.5267 }];
const OPERACOES_PADRAO = ['ARROZ', 'LATA', 'GRANEL', 'CIMENTO', 'SACARIA', 'SIDER', 'FARINHA', 'ACUCAR'];
const NOMES = ['João', 'Carlos', 'Pedro', 'Marcos', 'Ricardo', 'André', 'Fernando', 'Luiz', 'Paulo', 'Sérgio', 'Roberto', 'Márcia', 'Diego', 'Antônio', 'Felipe', 'Bruno', 'Rafael', 'Gustavo', 'Leandro', 'Vitor'];
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Lima', 'Carvalho', 'Gomes', 'Ribeiro', 'Martins', 'Araújo', 'Barbosa'];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)] as T;
}

function pickOperacoes(rnd: () => number, operacoesDisponiveis: string[]): string {
  const qtd = 1 + Math.floor(rnd() * 3);
  const set = new Set<string>();
  while (set.size < Math.min(qtd, operacoesDisponiveis.length)) set.add(pick(rnd, operacoesDisponiveis));
  return Array.from(set).join(' ; ');
}

function jitter(rnd: () => number, base: number, maxDelta: number): number {
  return base + (rnd() - 0.5) * 2 * maxDelta;
}

async function listarMotoristasSimulados(): Promise<MotoristaSim[]> {
  const lista = await directusListar<{
    id: number;
    telefone?: string;
    nome?: string;
    sobrenome?: string;
    observacao?: string;
  }>('cadastro_motorista', {
    'filter[observacao][_contains]': TAG_SIMULACAO_MOTORISTAS,
    fields: 'id,telefone,nome,sobrenome,observacao',
    limit: '2000',
    sort: 'id',
  });
  return lista
    .map((m) => ({
      id: Number(m.id),
      telefone: normalizarTelefone(String(m.telefone ?? '')),
      nome: String(m.nome ?? 'Motorista').trim() || 'Motorista',
      sobrenome: String(m.sobrenome ?? '').trim(),
    }))
    .filter((m) => Number.isFinite(m.id) && m.telefone.length >= 10);
}

async function listarOperacoesSimulacao(): Promise<string[]> {
  const rotas = await directusListar<{ operacao?: string; ativo?: boolean }>('config_rotas', {
    'filter[ativo][_eq]': 'true',
    fields: 'operacao,ativo',
    limit: '2000',
  }).catch(() => []);
  const set = new Set<string>();
  for (const rota of rotas) {
    const op = String(rota.operacao ?? '').trim().toUpperCase();
    if (op) set.add(op);
  }
  return set.size ? Array.from(set) : OPERACOES_PADRAO;
}

async function criarMotoristaSimulado(opts: {
  i: number;
  rnd: () => number;
  seedTag: string;
  operacoesDisponiveis: string[];
}): Promise<MotoristaSim> {
  const { i, rnd } = opts;
  const nome = pick(rnd, NOMES);
  const sobrenome = pick(rnd, SOBRENOMES);
  const cidade = pick(rnd, CIDADES);
  const tel = String(5500000000000 + i);
  const tipo_rota = pickOperacoes(rnd, opts.operacoesDisponiveis);
  const observacao = `${TAG_SIMULACAO_MOTORISTAS} ${opts.seedTag} #${i}`;

  const criado = await directusPost<{ id: number }>('cadastro_motorista', {
    status: 'active',
    nome,
    sobrenome,
    telefone: tel,
    cidade: cidade.cidade,
    estado: cidade.uf,
    tipo_rota,
    status_cadastro: 'SIMULADO',
    observacao,
  });

  const lat = jitter(rnd, cidade.lat, 0.09);
  const lng = jitter(rnd, cidade.lng, 0.09);
  const status = rnd() < 0.82 ? 'disponivel' : rnd() < 0.5 ? 'retornando' : 'carregado';
  const disponivel = status === 'disponivel';
  const horas = status === 'disponivel' ? 0 : 4 + Math.floor(rnd() * 48);
  const previsto = status === 'disponivel' ? null : new Date(estado.simNowMs + horas * 3600_000).toISOString();
  const prevCidade = status === 'disponivel' ? cidade : pick(rnd, CIDADES);
  const destinoAtual = status === 'disponivel' ? cidade : pick(rnd, CIDADES);
  const localPrev = `${prevCidade.cidade} ${prevCidade.uf}`;
  const localDestinoAtual = `${destinoAtual.cidade} ${destinoAtual.uf}`;

  await registrarDisponibilidade({
    telefone: tel,
    disponivel,
    status,
    localizacao_atual: `${cidade.cidade} ${cidade.uf}`,
    local_destino_atual: localDestinoAtual,
    local_liberacao_prevista: localPrev,
    local_disponibilidade: localPrev,
    latitude: lat,
    longitude: lng,
    local_liberacao_prevista_latitude: prevCidade.lat,
    local_liberacao_prevista_longitude: prevCidade.lng,
    local_liberacao_prevista_fonte: 'simulacao_seed',
    gps_timestamp: new Date(estado.simNowMs).toISOString(),
    data_previsao_disponibilidade: previsto ?? undefined,
    observacao,
  });

  return { id: Number(criado.id), telefone: normalizarTelefone(tel), nome, sobrenome };
}

let timer: NodeJS.Timeout | null = null;
let estado: {
  rodando: boolean;
  seed: number;
  tickMs: number;
  advanceHoursPorTick: number;
  simNowMs: number;
  qtd: number;
  tick: number;
  motoristas: MotoristaSim[];
} = { rodando: false, seed: 42, tickMs: 6000, advanceHoursPorTick: 6, simNowMs: Date.now(), qtd: 100, tick: 0, motoristas: [] };

export function statusSimulacaoMotoristas() {
  return {
    rodando: estado.rodando,
    tickMs: estado.tickMs,
    advanceHoursPorTick: estado.advanceHoursPorTick,
    simNow: new Date(estado.simNowMs).toISOString(),
    qtdAlvo: estado.qtd,
    tick: estado.tick,
    motoristas: estado.motoristas.length,
    tag: TAG_SIMULACAO_MOTORISTAS,
  };
}

export function definirAgoraSimulado(iso: string) {
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) estado.simNowMs = d.getTime();
  return { ok: true, simNow: new Date(estado.simNowMs).toISOString() };
}

export async function seedMotoristasSimulados(opts?: { qtd?: number; seed?: number }) {
  if (!directusConfigurado()) throw new Error('Directus não configurado (DIRECTUS_URL/DIRECTUS_TOKEN)');
  const qtd = Math.max(1, Math.min(500, opts?.qtd ?? estado.qtd));
  const seed = Number.isFinite(Number(opts?.seed)) ? Number(opts?.seed) : estado.seed;
  const rnd = mulberry32(seed);
  const operacoesDisponiveis = await listarOperacoesSimulacao();

  const existentes = await listarMotoristasSimulados();
  const falta = Math.max(0, qtd - existentes.length);
  const seedTag = `seed=${seed}`;
  let criados = 0;

  for (let i = 0; i < falta; i++) {
    const idx = existentes.length + i + 1;
    await criarMotoristaSimulado({ i: idx, rnd, seedTag, operacoesDisponiveis });
    criados++;
  }

  estado = { ...estado, qtd, seed, motoristas: await listarMotoristasSimulados() };
  return { ok: true, criados, total: estado.motoristas.length };
}

async function tickSimulacao() {
  if (!estado.motoristas.length) estado.motoristas = await listarMotoristasSimulados();
  const rnd = mulberry32(estado.seed + estado.tick);
  const total = estado.motoristas.length;
  if (!total) return;

  const pct = 0.03 + rnd() * 0.02;
  const qtd = Math.max(1, Math.ceil(total * pct));
  const indices = new Set<number>();
  while (indices.size < Math.min(qtd, total)) {
    indices.add(Math.floor(rnd() * total));
  }

  const agora = estado.simNowMs;
  for (const idx of indices) {
    const m = estado.motoristas[idx] as MotoristaSim | undefined;
    if (!m) continue;

    const cidade = pick(rnd, CIDADES);
    const mudaCidade = rnd() < 0.22;
    const atualCidade = mudaCidade ? cidade : pick(rnd, CIDADES);
    const status = rnd() < 0.80 ? 'disponivel' : rnd() < 0.5 ? 'retornando' : 'carregado';
    const disponivel = status === 'disponivel';
    const horas = disponivel ? 0 : 3 + Math.floor(rnd() * 60);
    const previsto = disponivel ? null : new Date(agora + horas * 3600_000).toISOString();
    const destinoPrev = pick(rnd, CIDADES);
    const destinoAtual = pick(rnd, CIDADES);
    const localAtual = `${atualCidade.cidade} ${atualCidade.uf}`;
    const localPrev = disponivel ? localAtual : `${destinoPrev.cidade} ${destinoPrev.uf}`;
    const localDestinoAtual = disponivel ? localAtual : `${destinoAtual.cidade} ${destinoAtual.uf}`;

    const lat = jitter(rnd, atualCidade.lat, 0.07);
    const lng = jitter(rnd, atualCidade.lng, 0.07);

    await registrarDisponibilidade({
      telefone: m.telefone,
      disponivel,
      status,
      localizacao_atual: localAtual,
      local_destino_atual: localDestinoAtual,
      local_liberacao_prevista: localPrev,
      local_disponibilidade: localPrev,
      latitude: lat,
      longitude: lng,
      local_liberacao_prevista_latitude: destinoPrev.lat,
      local_liberacao_prevista_longitude: destinoPrev.lng,
      local_liberacao_prevista_fonte: 'simulacao_tick',
      gps_timestamp: new Date(agora).toISOString(),
      data_previsao_disponibilidade: previsto ?? undefined,
      observacao: `${TAG_SIMULACAO_MOTORISTAS} tick=${estado.tick}`,
    }).catch(() => undefined);

    if (mudaCidade) {
      await directusPatch('cadastro_motorista', m.id, {
        cidade: atualCidade.cidade,
        estado: atualCidade.uf,
        status: 'active',
      }).catch(() => undefined);
    } else {
      await directusPatch('cadastro_motorista', m.id, { status: 'active' }).catch(() => undefined);
    }
  }
  estado.simNowMs = estado.simNowMs + Math.max(1, estado.advanceHoursPorTick) * 3600_000;
}

export async function iniciarSimulacaoMotoristas(opts?: { qtd?: number; seed?: number; tickMs?: number; advanceHoursPorTick?: number; nowIso?: string }) {
  const tickMs = Math.max(1500, Math.min(60_000, opts?.tickMs ?? estado.tickMs));
  const nextNow = opts?.nowIso ? new Date(opts.nowIso) : null;
  estado = {
    ...estado,
    tickMs,
    seed: opts?.seed ?? estado.seed,
    qtd: opts?.qtd ?? estado.qtd,
    advanceHoursPorTick: opts?.advanceHoursPorTick ?? estado.advanceHoursPorTick,
    ...(nextNow && !Number.isNaN(nextNow.getTime()) ? { simNowMs: nextNow.getTime() } : {}),
  };
  await seedMotoristasSimulados({ qtd: estado.qtd, seed: estado.seed });

  if (timer) clearInterval(timer);
  estado.rodando = true;
  timer = setInterval(() => {
    estado.tick++;
    void tickSimulacao();
  }, tickMs);
  return { ok: true, ...statusSimulacaoMotoristas() };
}

export async function pararSimulacaoMotoristas() {
  if (timer) clearInterval(timer);
  timer = null;
  estado.rodando = false;
  return { ok: true, ...statusSimulacaoMotoristas() };
}

export async function seedEmbarquesSimulados(opts?: { qtd?: number; seed?: number }) {
  if (!directusConfigurado()) throw new Error('Directus não configurado (DIRECTUS_URL/DIRECTUS_TOKEN)');
  const qtd = Math.max(1, Math.min(200, opts?.qtd ?? 30));
  const seed = Number.isFinite(Number(opts?.seed)) ? Number(opts?.seed) : estado.seed;
  const rnd = mulberry32(seed + 999);

  const rotas = await directusListar<{
    id: number;
    origem: string;
    destino: string;
    operacao?: string;
    valor_minimo: number;
    valor_maximo: number;
    ativo?: boolean;
    especie_produto?: string | null;
  }>('config_rotas', {
    'filter[ativo][_eq]': 'true',
    fields: 'id,origem,destino,operacao,valor_minimo,valor_maximo,ativo,especie_produto',
    limit: '2000',
  });
  const ativas = rotas.filter((r) => r.ativo !== false);
  if (!ativas.length) return { ok: false, erro: 'Sem config_rotas ativas' };

  let criados = 0;
  for (let i = 0; i < qtd; i++) {
    const rota = pick(rnd, ativas);
    const min = Number(rota.valor_minimo);
    const max = Number(rota.valor_maximo);
    const pickup = new Date(estado.simNowMs + (6 + Math.floor(rnd() * 24 * 10)) * 3600_000).toISOString();
    const total = min + Math.floor(rnd() * Math.max(0, max - min + 1));
    await directusPost('embarques', {
      status: rnd() < 0.55 ? 'new' : 'needs_attention',
      origin: rota.origem,
      destination: rota.destino,
      pickup_date: pickup,
      config_rota_id: rota.id,
      rota_status: 'correlacionada',
      operacao: rota.operacao ?? null,
      valor_minimo: min,
      valor_maximo: max,
      valor_ofertado: min,
      total_value: total,
      produto_predominante: rota.especie_produto ?? rota.operacao ?? null,
      observacao: `${TAG_SIMULACAO_EMBARQUES} seed=${seed} #${i + 1}`,
    }).catch(() => undefined);
    criados++;
  }
  return { ok: true, criados };
}
