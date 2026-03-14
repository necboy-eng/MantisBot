import { useState, useEffect } from 'react';
import { X, Save, Loader2, AlertCircle, ChevronRight, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  filePath: string;
}

interface SkillEditorPanelProps {
  skill: Skill;
  onClose: () => void;
  onLoadFiles: (skillName: string) => Promise<string[]>;
  onLoadContent: (skillName: string, filePath: string) => Promise<string>;
  onSaveContent: (skillName: string, filePath: string, content: string) => Promise<boolean>;
  readOnly?: boolean;
}

export function SkillEditorPanel({ skill, onClose, onLoadFiles, onLoadContent, onSaveContent, readOnly = false }: SkillEditorPanelProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isDirty = content !== originalContent;

  // Load file list when skill changes
  useEffect(() => {
    setLoadingFiles(true);
    setFiles([]);
    setSelectedFile('');
    setContent('');
    setOriginalContent('');
    setSaveError(null);
    setSaveSuccess(false);
    onLoadFiles(skill.name).then(fileList => {
      setFiles(fileList);
      const defaultFile = fileList.includes('SKILL.md') ? 'SKILL.md' : (fileList[0] ?? '');
      setSelectedFile(defaultFile);
      setLoadingFiles(false);
    }).catch(() => setLoadingFiles(false));
  }, [skill.name]);

  // Load file content when selected file changes
  useEffect(() => {
    if (!selectedFile) return;
    setLoadingContent(true);
    setSaveError(null);
    onLoadContent(skill.name, selectedFile).then(fileContent => {
      setContent(fileContent);
      setOriginalContent(fileContent);
      setLoadingContent(false);
    }).catch(() => setLoadingContent(false));
  }, [skill.name, selectedFile]);

  async function handleSave() {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const ok = await onSaveContent(skill.name, selectedFile, content);
    if (ok) {
      setOriginalContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } else {
      setSaveError(t('skillEditor.saveFailed'));
    }
    setSaving(false);
  }

  // Sort files: SKILL.md first, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    if (a === 'SKILL.md') return -1;
    if (b === 'SKILL.md') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
            {skill.name}
          </span>
          {readOnly && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded flex-shrink-0">
              <Lock className="w-3 h-3" />
              只读
            </span>
          )}
          {!readOnly && isDirty && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded flex-shrink-0">
              {t('skillEditor.unsaved')}
            </span>
          )}
          {saveSuccess && !readOnly && (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded flex-shrink-0">
              {t('skillEditor.saved')}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors ml-2 flex-shrink-0"
          title={t('skillEditor.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body: file list + editor */}
      <div className="flex flex-1 min-h-0">
        {/* File list */}
        <div className="w-44 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-gray-50 dark:bg-gray-800/50">
          {loadingFiles ? (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="py-1">
              {sortedFiles.map(file => (
                <button
                  key={file}
                  onClick={() => setSelectedFile(file)}
                  title={file}
                  className={`w-full text-left flex items-center gap-1 px-3 py-2 text-xs transition-colors ${
                    selectedFile === file
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-opacity ${selectedFile === file ? 'opacity-100 text-primary-500' : 'opacity-0'}`} />
                  <span className="truncate">{file}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0">
          {loadingContent ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <textarea
              value={content}
              onChange={e => { if (!readOnly) setContent(e.target.value); }}
              readOnly={readOnly}
              className={`flex-1 w-full p-4 font-mono text-xs resize-none bg-transparent text-gray-900 dark:text-gray-100 focus:outline-none ${readOnly ? 'cursor-default select-text' : ''}`}
              spellCheck={false}
              placeholder={t('skillEditor.placeholder')}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {saveError ? (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            {saveError}
          </div>
        ) : (
          <span className="text-xs text-gray-400 truncate">{selectedFile}</span>
        )}
        {readOnly ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 ml-4 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" />
            无编辑权限
          </span>
        ) : (
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-4 flex-shrink-0"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {t('skillEditor.save')}
          </button>
        )}
      </div>
    </div>
  );
}
