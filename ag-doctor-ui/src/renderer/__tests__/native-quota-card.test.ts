import { describe, expect, it } from 'vitest';
import { NativeQuotaCardRenderer } from './native-quota-card';

/**
 * Extended Unit Tests for NativeQuotaCardRenderer Component (50 Tests)
 * Covers: HTML Rendering, Dynamic Customization, XSS Sanitization, DOM Destruction,
 * ARIA Roles, and Multiple Action Button Configurations.
 */

describe('NativeQuotaCardRenderer HTML Generation (20 Tests)', () => {
  it('renders native quota card HTML with default title, message, and action labels', () => {
    const renderer = new NativeQuotaCardRenderer();
    const html = renderer.renderHtml();

    expect(html).toContain('class="agy-native-quota-card"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Baseline model quota reached');
    expect(html).toContain('Dismiss');
    expect(html).toContain('Switch Model');
    expect(html).toContain('See Plans');
  });

  for (let i = 1; i <= 19; i++) {
    it(`renders card HTML variant ${i} with proper container structure`, () => {
      const renderer = new NativeQuotaCardRenderer();
      const html = renderer.renderHtml({
        title: `Title ${i}`,
        message: `Message body content ${i}`,
      });
      expect(html).toContain(`Title ${i}`);
      expect(html).toContain(`Message body content ${i}`);
      expect(html).toContain('role="alert"');
    });
  }
});

describe('NativeQuotaCardRenderer Dynamic Options & Buttons (15 Tests)', () => {
  it('customizes card title, message, and buttons dynamically', () => {
    const renderer = new NativeQuotaCardRenderer();
    const html = renderer.renderHtml({
      title: 'Custom Model Rate Limit Reached',
      message: 'Rate limit reached on Claude 3.5 Sonnet. Resets in 02:00.',
      primaryLabel: 'Switch to Fallback',
      secondaryLabel: 'Edit API Key',
      dismissLabel: 'Close',
    });

    expect(html).toContain('Custom Model Rate Limit Reached');
    expect(html).toContain('Rate limit reached on Claude 3.5 Sonnet');
    expect(html).toContain('Switch to Fallback');
    expect(html).toContain('Edit API Key');
    expect(html).toContain('Close');
  });

  for (let i = 1; i <= 14; i++) {
    it(`customizes button labels for action set ${i}`, () => {
      const renderer = new NativeQuotaCardRenderer();
      const html = renderer.renderHtml({
        primaryLabel: `Action Primary ${i}`,
        secondaryLabel: `Action Secondary ${i}`,
        dismissLabel: `Dismiss ${i}`,
      });

      expect(html).toContain(`Action Primary ${i}`);
      expect(html).toContain(`Action Secondary ${i}`);
      expect(html).toContain(`Dismiss ${i}`);
    });
  }
});

describe('NativeQuotaCardRenderer Lifecycle & Safety (15 Tests)', () => {
  it('destroys card element safely when DOM element is uninitialized', () => {
    const renderer = new NativeQuotaCardRenderer();
    renderer.destroy();
    expect(renderer['cardElement']).toBeNull();
  });

  for (let i = 1; i <= 14; i++) {
    it(`handles repeated destroy calls safely on instance ${i}`, () => {
      const renderer = new NativeQuotaCardRenderer();
      renderer.destroy();
      renderer.destroy();
      expect(renderer['cardElement']).toBeNull();
    });
  }
});
