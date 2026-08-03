import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiVersionService {
  constructor(private readonly configService: ConfigService) {}

  getVersionMetadata() {
    const current = this.configService.get<string>('API_VERSION') ?? 'v1';
    return {
      current,
      supported: [current],
      deprecated: [],
      header: 'X-API-Version',
      discoveredAt: new Date().toISOString(),
    };
  }
}
