import http from 'http';

export interface CreateCascadeOptions {
  workspacePath: string;
}

export interface CascadeMessage {
  role: 'ROLE_USER' | 'ROLE_MODEL';
  parts: Array<{ text: string }>;
}

export interface SendCascadeMessageOptions {
  cascadeId: string;
  message: CascadeMessage;
}

export interface SubmitToolApprovalOptions {
  cascadeId: string;
  callId: string;
  decision: 'DECISION_ALLOW' | 'DECISION_DENY';
}

export class ConnectRpcClient {
  constructor(
    private port: number,
    private csrfToken: string,
    private host = process.env.AG_BIND_HOST || '127.0.0.1'
  ) {}

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/connect+json',
      'X-CSRF-Token': this.csrfToken,
      'Connect-Protocol-Version': '1',
    };
  }

  public async createCascade(workspacePath: string): Promise<any> {
    return this.post('/antigravity.v1.CascadeService/CreateCascade', { workspacePath });
  }

  public async getAllCascades(): Promise<any> {
    return this.post('/antigravity.v1.CascadeService/GetAllCascades', {});
  }

  public async submitToolApproval(options: SubmitToolApprovalOptions): Promise<any> {
    return this.post('/antigravity.v1.CascadeService/SubmitToolApproval', options);
  }

  public async sendCascadeMessage(
    options: SendCascadeMessageOptions,
    onChunk?: (data: string) => void
  ): Promise<void> {
    const payload = JSON.stringify(options);
    const headers = { ...this.getHeaders(), 'Content-Length': Buffer.byteLength(payload).toString() };

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path: '/antigravity.v1.CascadeService/SendCascadeMessage',
          method: 'POST',
          headers,
        },
        (res) => {
          res.on('data', (chunk) => {
            const str = chunk.toString('utf-8');
            if (onChunk) onChunk(str);
          });
          res.on('end', () => resolve());
          res.on('error', (err) => reject(err));
        }
      );

      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }

  private async post(path: string, body: any): Promise<any> {
    const payload = JSON.stringify(body);
    const headers = { ...this.getHeaders(), 'Content-Length': Buffer.byteLength(payload).toString() };

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve({ raw: data });
            }
          });
          res.on('error', (err) => reject(err));
        }
      );

      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}
