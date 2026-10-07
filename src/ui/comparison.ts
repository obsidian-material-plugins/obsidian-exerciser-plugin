import { App, Modal, Setting } from 'obsidian';

const visible = (value: string) =>
	value.replace(/ /g, '·').replace(/\t/g, '⇥').replace(/\r/g, '␍').replace(/\n/g, '↵\n');

export class ComparisonModal extends Modal {
	private actual = '';
	private readonly expected: string;

	constructor(app: App, expected: string) {
		super(app);
		this.expected = expected;
	}

	onOpen() {
		this.setTitle('Compare output');
		this.contentEl.createEl('p', {
			text: 'Spaces, punctuation, capitalization, and line endings count.',
			cls: 'exerciser-muted',
		});
		const fields = this.contentEl.createDiv('exerciser-comparison-inputs');
		const expectedField = fields.createEl('label');
		expectedField.createEl('strong', { text: 'Expected' });
		expectedField.createEl('textarea', { attr: { readonly: 'true' }, text: this.expected });
		const actualField = fields.createEl('label');
		actualField.createEl('strong', { text: 'Your output' });
		const actual = actualField.createEl('textarea', {
			attr: { placeholder: 'Paste your program output here…' },
		});
		actual.addEventListener('input', () => (this.actual = actual.value));
		const result = this.contentEl.createEl('pre', { cls: 'exerciser-diff' });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Close').onClick(() => this.close()))
			.addButton((button) =>
				button.setCta().setButtonText('Compare').onClick(() => {
					result.replaceChildren();
					if (this.expected === this.actual) {
						result.createSpan({ text: 'No differences found.' });
						return;
					}
					result.createSpan({
						cls: 'exerciser-diff-expected',
						text: `− Expected\n${visible(this.expected)}\n`,
					});
					result.createSpan({
						cls: 'exerciser-diff-actual',
						text: `+ Your output\n${visible(this.actual)}\n`,
					});
					if (!this.expected.endsWith('\n') || !this.actual.endsWith('\n')) {
						result.createSpan({ text: '∅ missing final newline' });
					}
				}),
			);
	}
}
