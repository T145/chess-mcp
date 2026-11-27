import { randomInt } from 'node:crypto';

import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Express, NextFunction, Request, Response } from 'express';
import * as z from 'zod/v4';

import { UserError } from '../errors.js';
import { createMcpServer } from '../mcp.js';
import type {
  Color,
  CreateGameRequest,
  DrawRequest,
  JoinSeatRequest,
  MoveRequest,
  ResignRequest
} from '../shared/protocol.js';
import type { GameStore } from '../store.js';

const createGameSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.enum(['white', 'black', 'random', 'none'])
}) satisfies z.ZodType<CreateGameRequest>;

const joinSeatSchema = z.object({
  name: z.string().min(1).max(40),
  seat: z.enum(['white', 'black'])
}) satisfies z.ZodType<JoinSeatRequest>;

const moveSchema = z.object({
  move: z.union([
    z.string().min(1),
    z.object({
      from: z.string().min(2).max(2),
      to: z.string().min(2).max(2),
      promotion: z.enum(['q', 'r', 'b', 'n']).optional()
    })
  ]),
  token: z.string().min(1).optional()
}) satisfies z.ZodType<MoveRequest>;

const drawSchema = z.object({
  action: z.enum(['offer', 'accept', 'decline']),
  token: z.string().min(1).optional(),
  seat: z.enum(['white', 'black']).optional()
}) satisfies z.ZodType<DrawRequest>;

const resignSchema = z.object({
  token: z.string().min(1).optional(),
  seat: z.enum(['white', 'black']).optional()
}) satisfies z.ZodType<ResignRequest>;

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new UserError(`Invalid request: ${detail}`);
  }
  return result.data;
}

export interface AppBundle {
  app: Express;
  mcpHandler: ReturnType<typeof createMcpHandler>;
}

export function createApp(store: GameStore): AppBundle {
  const app = createMcpExpressApp();

  const mcpHandler = createMcpHandler(() => createMcpServer(store));
  const nodeHandler = toNodeHandler(mcpHandler);
  app.all('/mcp', (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, games: store.list().length });
  });

  app.get('/api/games', (_req, res) => {
    res.json({ games: store.list() });
  });

  app.get('/api/games/:id', (req, res) => {
    res.json({ game: store.getPublic(req.params.id) });
  });

  app.post('/api/games', (req, res) => {
    const body = parseBody(createGameSchema, req.body);
    const color: Color | 'none' =
      body.color === 'random' ? (randomInt(2) === 0 ? 'white' : 'black') : body.color;
    const created = store.create({ as: color, name: body.name, kind: 'human' });
    res.status(201).json(created);
  });

  app.post('/api/games/:id/join', (req, res) => {
    const body = parseBody(joinSeatSchema, req.body);
    const joined = store.join(req.params.id, body.seat, body.name, 'human');
    res.json(joined);
  });

  app.post('/api/games/:id/moves', (req, res) => {
    const body = parseBody(moveSchema, req.body);
    const game = store.move(req.params.id, body.move, body.token);
    res.json({ game });
  });

  app.post('/api/games/:id/draw', (req, res) => {
    const body = parseBody(drawSchema, req.body);
    const game = store.draw(req.params.id, body.action, body.token, body.seat);
    res.json({ game });
  });

  app.post('/api/games/:id/resign', (req, res) => {
    const body = parseBody(resignSchema, req.body);
    const game = store.resign(req.params.id, body.token, body.seat);
    res.json({ game });
  });

  app.delete('/api/games/:id', (req, res) => {
    store.delete(req.params.id);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof UserError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, mcpHandler };
}
