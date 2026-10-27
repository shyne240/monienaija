import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CashToCashLocatorDto } from '../src/agent/dto/cash-to-cash-claim.dto';
import { NotificationTemplateService } from '../src/notification/notification-template.service';

describe('Cash-to-Cash public locator contract', () => {
  it('accepts leading zeros as a string, never a numeric locator', async () => {
    expect(await validate(plainToInstance(CashToCashLocatorDto, {
      senderPhone: '08031234567', transferNumber: '000001',
    }))).toHaveLength(0);
    for (const transferNumber of [1, '12345', '1234567', ' 123456', '12a456']) {
      expect((await validate(plainToInstance(CashToCashLocatorDto, {
        senderPhone: '08031234567', transferNumber,
      }))).length).toBeGreaterThan(0);
    }
  });

  it('does not disclose locator components, an internal UUID or a secret in ordinary notification text', () => {
    const message = new NotificationTemplateService().buildMessage('cash_to_cash.created', {
      reference: 'a-long-unrelated-display-reference',
      senderPhone: '8031234567', transferNumber: '000001',
      transferId: 'internal-uuid', transferCode: 'secret-code', amountMinor: '2000',
    });
    expect(message).not.toContain('000001');
    expect(message).not.toContain('8031234567');
    expect(message).not.toContain('internal-uuid');
    expect(message).not.toContain('secret-code');
    expect(message).not.toContain('a-long-unrelated');
  });
});
