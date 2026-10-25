import { describe, expect, it } from 'vitest';
import { globalSettingsNotePath } from '../src/settings-note';
import { getPreviewLimit } from '../src/vault-service';

describe('portable global settings filename', () => {
	it('uses the contracted name and keeps the standalone index fallback', () => {
		expect(globalSettingsNotePath(null)).toBe('index.md');
		expect(globalSettingsNotePath({ contract: 'book-structure/v2', globalNote: 'Overview.md' })).toBe('Overview.md');
	});

	it('rejects unsupported and path-like conventions', () => {
		expect(() => globalSettingsNotePath({ contract: 'book-structure/v3', globalNote: 'index.md' })).toThrow();
		expect(() => globalSettingsNotePath({ contract: 'book-structure/v2', globalNote: '../secret.md' })).toThrow();
	});

	it('uses the selected global note for the preview limit', async () => {
		const files = new Map([
			['.obsidian-to-quartz-workspace.json', JSON.stringify({ contract: 'book-structure/v2', globalNote: 'overview.md', localNotePattern: 'index.md' })],
			['overview.md', '---\nexercise-preview-size-limit: 10\n---\n'],
			['index.md', '---\nexercise-preview-size-limit: 1\n---\n'],
		]);
		const app = { vault: { adapter: {
			exists: async (file: string) => files.has(file),
			read: async (file: string) => files.get(file)!,
		} } } as never;
		expect(await getPreviewLimit(app)).toBe(10);
	});

	it('reports malformed and unsupported records with the record path', async () => {
		let contents = '{';
		const app = { vault: { adapter: {
			exists: async () => true,
			read: async () => contents,
		} } } as never;
		await expect(getPreviewLimit(app)).rejects.toThrow('.obsidian-to-quartz-workspace.json');
		contents = JSON.stringify({ contract: 'book-structure/v3', globalNote: 'index.md' });
		await expect(getPreviewLimit(app)).rejects.toThrow('Unsupported settings-note convention');
	});
});
