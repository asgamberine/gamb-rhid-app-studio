import type { Punch } from '../types';

export interface RhidGateway {
  listPunches(date: string): Promise<Punch[]>;
  registerPunch(): Promise<Punch>;
}

export class RhidIntegrationUnavailableError extends Error {
  constructor() {
    super('Integração RHiD requer documentação da API e credenciais seguras.');
  }
}

export class DisabledRhidGateway implements RhidGateway {
  async listPunches(): Promise<Punch[]> {
    throw new RhidIntegrationUnavailableError();
  }

  async registerPunch(): Promise<Punch> {
    throw new RhidIntegrationUnavailableError();
  }
}
