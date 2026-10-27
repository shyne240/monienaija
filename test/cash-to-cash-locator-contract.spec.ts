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

  it('never renders a transfer number, sender phone, transfer UUID or secret code', () => {
    const message = new NotificationTemplateService().buildMessage('cash_to_cash.created', {
      reference: 'a-long-unrelated-display-reference',
      senderPhone: '8031234567', transferNumber: '000001',
      transferId: 'internal-uuid', transferCode: 'secret-code', amountMinor: '2000',
    });
    expect(message).toContain('A MonieNaija customer');
    expect(message).toContain('NGN 20.00');
    for (const forbidden of ['000001', '8031234567', 'internal-uuid', 'secret-code', 'a-long-unrelated']) {
      expect(message).not.toContain(forbidden);
    }
  });
});
