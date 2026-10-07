import { App, Modal, Notice, Setting } from 'obsidian';
import {
	chooseDirectory,
	copyExercise,
	launchEditor,
	openDirectory,
	suggestedLauncher,
} from '../copy-service';

export class TextPromptModal extends Modal {
	private readonly titleText: string;
	private readonly placeholder: string;
	private readonly submitLabel: string;
	private readonly onSubmit: (value: string) => void | Promise<void>;

	constructor(
		app: App,
		title: string,
		placeholder: string,
		submitLabel: string,
		onSubmit: (value: string) => void | Promise<void>,
	) {
		super(app);
		this.titleText = title;
		this.placeholder = placeholder;
		this.submitLabel = submitLabel;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		this.setTitle(this.titleText);
		let value = '';
		new Setting(this.contentEl)
			.addText((input) => {
				input.setPlaceholder(this.placeholder).onChange((next) => (value = next));
				input.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') void submit();
				});
				input.inputEl.focus();
			})
			.addButton((button) => button.setCta().setButtonText(this.submitLabel).onClick(() => void submit()));
		const submit = async () => {
			const clean = value.trim();
			if (!clean) return;
			try {
				await this.onSubmit(clean);
				this.close();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : String(error));
			}
		};
	}
}

export class DestinationModal extends Modal {
	private destination: string;
	private readonly exercise: string;
	private readonly onSelected: (destination: string) => Promise<void>;

	constructor(
		app: App,
		exercise: string,
		remembered: string | null,
		onSelected: (destination: string) => Promise<void>,
	) {
		super(app);
		this.exercise = exercise;
		this.destination = remembered ?? '';
		this.onSelected = onSelected;
	}

	onOpen() {
		this.setTitle('Copy exercise');
		this.contentEl.createEl('p', {
			text: `Copy ${this.exercise} to a folder on your computer. The original vault template stays unchanged.`,
		});
		const preview = this.contentEl.createEl('code', { cls: 'exerciser-destination-preview' });
		const updatePreview = () => {
			preview.textContent = this.destination
				? `${this.destination}/${this.exercise}/`
				: 'Choose a destination folder';
		};
		new Setting(this.contentEl)
			.setName('Destination')
			.setDesc('This destination is remembered on this device and reused for future copies.')
			.addText((input) =>
				input
					.setPlaceholder('Choose a destination folder')
					.setValue(this.destination)
					.onChange((value) => {
						this.destination = value.trim();
						updatePreview();
					}),
			)
			.addButton((button) =>
				button.setButtonText('Browse…').onClick(async () => {
					const chosen = await chooseDirectory();
					if (chosen) {
						this.destination = chosen;
						this.close();
						new DestinationModal(this.app, this.exercise, chosen, this.onSelected).open();
					}
				}),
			);
		updatePreview();
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button.setCta().setButtonText('Copy exercise').onClick(async () => {
					if (!this.destination) return;
					try {
						await this.onSelected(this.destination);
						this.close();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : String(error));
					}
				}),
			);
	}
}

export class CopySuccessModal extends Modal {
	constructor(
		app: App,
		private readonly exercise: string,
		private readonly target: string,
		private readonly copied: string[],
	) {
		super(app);
	}

	async onOpen() {
		this.setTitle('Exercise copied');
		this.contentEl.createEl('p', { text: `${this.exercise} is ready in ${this.target}.` });
		this.contentEl.createEl('p', {
			text: 'Open the copied exercise root folder in your local editor. The original vault template is unchanged.',
		});
		const launcher = await suggestedLauncher(this.copied);
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Open directory').onClick(async () => {
					try {
						await openDirectory(this.target);
					} catch (error) {
						new Notice(error instanceof Error ? error.message : String(error));
					}
				}),
			)
			.addButton((button) => {
				if (!launcher) return button.setButtonText('Directory only').setDisabled(true);
				return button
					.setCta()
					.setButtonText(launcher.label)
					.onClick(() => launchEditor(launcher.command, this.target));
			});
	}
}

export class DestinationNoticeModal extends Modal {
	onOpen() {
		this.setTitle('Your copy destination is remembered locally');
		this.contentEl.createEl('p', {
			text: '.gitignore protects your personal paths. The chosen absolute destination is stored in a local marker/cache in the vault.',
		});
		this.contentEl.createEl('p', {
			text: 'If you remove the ignore rule, it will not be recreated automatically. Restore it with the copy-destination ignore command.',
		});
		new Setting(this.contentEl).addButton((button) =>
			button.setCta().setButtonText('Got it').onClick(() => this.close()),
		);
	}
}

export const copyWithFeedback = async (app: App, exercise: string, destination: string) => {
	const result = await copyExercise(app, exercise, destination);
	new CopySuccessModal(app, exercise, result.target, result.copied).open();
};
