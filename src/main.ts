import { Editor, MarkdownView, Menu, Notice, Plugin } from 'obsidian';
import YAML from 'yaml';
import {
	addDestinationIgnoreRule,
	readDestination,
	writeDestination,
} from './copy-service';
import { parseFence } from './config';
import type { ExerciseCreationSpec, ExerciserPluginData } from './types';
import { createExercise, createExerciseFromSpec } from './vault-service';
import { NewExerciseWizardModal } from './ui/exercise-wizard';
import {
	copyWithFeedback,
	DestinationModal,
	DestinationNoticeModal,
	TextPromptModal,
} from './ui/modals';
import { registerExerciseBlock, type ViewerHost } from './ui/viewer';

const DEFAULT_DATA: ExerciserPluginData = {
	ignoreRuleProvisioned: false,
	destinationNoticeShown: false,
};

export default class ExerciserPlugin extends Plugin implements ViewerHost {
	private data: ExerciserPluginData = { ...DEFAULT_DATA };

	async onload() {
		this.data = { ...DEFAULT_DATA, ...((await this.loadData()) as Partial<ExerciserPluginData> | null) };
		this.registerMarkdownCodeBlockProcessor('exercise', (source, element, context) => {
			registerExerciseBlock(this, source, element, context, parseFence);
		});

		this.addCommand({
			id: 'create-new-exercise-here',
			name: 'Create new exercise here…',
			editorCallback: (editor) => this.openNewExerciseWizard(editor),
		});
		this.addCommand({
			id: 'create-empty-exercise',
			name: 'Create empty exercise folder…',
			callback: () => this.promptForEmptyExercise(),
		});
		this.addCommand({
			id: 'insert-exercise-viewer',
			name: 'Insert existing exercise viewer…',
			editorCallback: (editor) => this.promptToInsertExisting(editor),
		});
		this.addCommand({
			id: 'add-copy-destination-ignore-rule',
			name: 'Add copy destination ignore rule',
			callback: () => void this.addIgnoreRuleManually(),
		});

		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			menu.addItem((item) => item
				.setTitle('Create new exercise here…')
				.setIcon('file-plus-2')
				.onClick(() => this.openNewExerciseWizard(editor)));
		}));
	}

	private openNewExerciseWizard(editor: Editor) {
		new NewExerciseWizardModal(this.app, async (spec) => {
			await createExerciseFromSpec(this.app, spec);
			this.insertFence(editor, spec);
			new Notice(`Created exercise “${spec.name}”.`);
		}).open();
	}

	private insertFence(editor: Editor, spec: ExerciseCreationSpec) {
		const yaml = YAML.stringify(spec.fence).trimEnd();
		const block = `\n\`\`\`exercise\n${yaml}\n\`\`\`\n`;
		editor.replaceSelection(block);
	}

	private promptForEmptyExercise() {
		new TextPromptModal(
			this.app,
			'Create exercise',
			'hello-world',
			'Create',
			async (name) => {
				await createExercise(this.app, name);
				new Notice(`Created ${name} in content/assets/exercises.`);
			},
		).open();
	}

	private promptToInsertExisting(editor: Editor) {
		new TextPromptModal(
			this.app,
			'Insert exercise viewer',
			'hello-world',
			'Insert',
			(name) => {
				this.insertFence(editor, {
					name,
					files: [],
					manifest: {
						version: 1,
						files: { 'hide-from-preview': [], 'exclude-from-quartz': [] },
						preview: { 'ignore-size-limit': false },
						outputs: [],
						highlights: [],
						annotations: [],
					},
					fence: { exercise: name, layout: 'ide', 'word-wrap': true },
				});
			},
		).open();
	}

	async startCopy(exercise: string) {
		const remembered = await readDestination(this.app);
		new DestinationModal(this.app, exercise, remembered, async (destination) => {
			if (!this.data.ignoreRuleProvisioned) {
				await addDestinationIgnoreRule(this.app);
				this.data.ignoreRuleProvisioned = true;
				await this.saveData(this.data);
			}
			await writeDestination(this.app, destination);
			await copyWithFeedback(this.app, exercise, destination);
			if (!this.data.destinationNoticeShown) {
				this.data.destinationNoticeShown = true;
				await this.saveData(this.data);
				new DestinationNoticeModal(this.app).open();
			}
		}).open();
	}

	async createMissingExercise(exercise: string) {
		await createExercise(this.app, exercise);
		new Notice(`Created ${exercise}.`);
	}

	private async addIgnoreRuleManually() {
		const added = await addDestinationIgnoreRule(this.app);
		this.data.ignoreRuleProvisioned = true;
		await this.saveData(this.data);
		new Notice(added ? 'Added the copy-destination ignore rule.' : 'The ignore rule is already present.');
	}

	onunload() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		view?.contentEl.querySelectorAll('.obsidian-exerciser-viewer').forEach((element) => element.remove());
	}
}
