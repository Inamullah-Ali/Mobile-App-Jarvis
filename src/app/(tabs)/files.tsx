import Ionicons from '@react-native-vector-icons/ionicons'
import { Directory, File, Paths } from 'expo-file-system'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

type Entry = { kind: 'file'; value: File } | { kind: 'directory'; value: Directory }
type PendingOperation = { kind: 'copy' | 'move'; entry: Entry }
type NameDialog = { kind: 'folder' | 'file' | 'rename'; entry?: Entry; value: string }

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml',
  '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.py', '.java',
])
const MAX_EDIT_SIZE = 1024 * 1024

function isDirectory(entry: Directory | File): entry is Directory {
  return entry instanceof Directory
}

function displaySize(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function normalizedUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`
}

function getDocumentRoot(): Directory | null {
  if (Platform.OS === 'web') return null
  try {
    return Paths.document
  } catch (error) {
    console.error('[Files] Could not open app storage:', error)
    return null
  }
}

export default function FilesScreen() {
  const [root] = useState(getDocumentRoot)
  const [breadcrumbs, setBreadcrumbs] = useState<Directory[]>(() => root ? [root] : [])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(Platform.OS !== 'web' && root !== null)
  const [error, setError] = useState<string | null>(root || Platform.OS === 'web' ? null : 'App storage is unavailable on this device.')
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null)
  const [editingFile, setEditingFile] = useState<File | null>(null)
  const [editorText, setEditorText] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const currentDirectory = breadcrumbs[breadcrumbs.length - 1] ?? null
  const currentPath = useMemo(
    () => breadcrumbs.map((directory) => directory.name || 'Files').join(' / '),
    [breadcrumbs],
  )

  const refresh = useCallback(() => {
    if (!currentDirectory || Platform.OS === 'web') return
    setLoading(true)
    setRefreshKey((current) => current + 1)
  }, [currentDirectory])

  useEffect(() => {
    if (!currentDirectory || Platform.OS === 'web') return
    const timer = setTimeout(() => {
    try {
      const listed = currentDirectory.list()
      const mapped: Entry[] = listed.map((value): Entry => (
        isDirectory(value)
          ? { kind: 'directory', value }
          : { kind: 'file', value }
      ))
      setEntries(mapped.sort((a, b) => (
        a.kind !== b.kind
          ? a.kind === 'directory' ? -1 : 1
          : a.value.name.localeCompare(b.value.name)
      )))
      setError(null)
    } catch (loadError) {
      console.error('[Files] Could not list app storage:', loadError)
      setEntries([])
      setError('This folder could not be opened. Try refreshing or go back.')
    } finally {
      setLoading(false)
    }
    }, 0)
    return () => clearTimeout(timer)
  }, [currentDirectory, refreshKey])

  const showError = (title: string, operationError: unknown) => {
    console.error(`[Files] ${title}:`, operationError)
    Alert.alert(title, 'The operation could not be completed. Check the item and try again.')
  }

  const navigateTo = (directory: Directory) => {
    if (!root) return
    setLoading(true)
    setBreadcrumbs((current) => {
      const existing = current.findIndex((item) => item.uri === directory.uri)
      if (existing >= 0) return current.slice(0, existing + 1)
      return [...current, directory]
    })
  }

  const validateName = (rawName: string): string | null => {
    const name = rawName.trim()
    if (!name) return 'Enter a name.'
    if (name.length > 100) return 'Names must be 100 characters or fewer.'
    if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
      return 'Use a name without path separators or reserved characters.'
    }
    return null
  }

  const hasNameCollision = (name: string, excluding?: Entry) => (
    currentDirectory?.list().some((item) => (
      item.uri !== excluding?.value.uri && item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )) ?? false
  )

  const submitNameDialog = () => {
    if (!nameDialog || !currentDirectory || busy) return
    const name = nameDialog.value.trim()
    const validationError = validateName(name)
    if (validationError) {
      Alert.alert('Invalid name', validationError)
      return
    }
    const newName = nameDialog.kind === 'file' && !name.includes('.')
      ? `${name}.txt`
      : name

    setBusy(true)
    try {
      if (hasNameCollision(newName, nameDialog.entry)) {
        Alert.alert('Name already exists', 'Choose a name that is not already in this folder.')
        return
      }
      if (nameDialog.kind === 'folder') {
        currentDirectory.createDirectory(newName).create()
      } else if (nameDialog.kind === 'file') {
        currentDirectory.createFile(newName, 'text/plain').create()
      } else if (nameDialog.entry) {
        nameDialog.entry.value.rename(newName)
      }
      setNameDialog(null)
      refresh()
    } catch (operationError) {
      showError('Could not save name', operationError)
    } finally {
      setBusy(false)
    }
  }

  const beginEdit = async (file: File) => {
    if (file.size > MAX_EDIT_SIZE) {
      Alert.alert('File too large', 'Text editing is limited to files up to 1 MB.')
      return
    }
    try {
      setEditorText(await file.text())
      setEditingFile(file)
      setSelectedEntry(null)
    } catch (operationError) {
      showError('Could not open file', operationError)
    }
  }

  const saveText = () => {
    if (!editingFile || busy) return
    if (new Blob([editorText]).size > MAX_EDIT_SIZE) {
      Alert.alert('Text is too large', 'Edited text must stay within the 1 MB limit.')
      return
    }
    setBusy(true)
    try {
      editingFile.write(editorText)
      setEditingFile(null)
      refresh()
    } catch (operationError) {
      showError('Could not save file', operationError)
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = (entry: Entry) => {
    Alert.alert(
      'Delete item?',
      `“${entry.value.name}” will be permanently deleted from this app's storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              entry.value.delete()
              setSelectedEntry(null)
              refresh()
            } catch (operationError) {
              showError('Could not delete item', operationError)
            }
          },
        },
      ],
    )
  }

  const pastePending = async () => {
    if (!pendingOperation || !currentDirectory || busy) return
    const { entry, kind } = pendingOperation
    const destinationUri = normalizedUri(currentDirectory.uri)
    const sourceUri = normalizedUri(entry.value.uri)
    if (entry.kind === 'directory' && (destinationUri === sourceUri || destinationUri.startsWith(sourceUri))) {
      Alert.alert('Choose another folder', 'A folder cannot be copied or moved inside itself.')
      return
    }

    setBusy(true)
    try {
      if (entry.kind === 'file') {
        const destination = new File(currentDirectory, entry.value.name)
        if (destination.exists) throw new Error('Destination already exists')
        if (kind === 'copy') await entry.value.copy(destination)
        else await entry.value.move(destination)
      } else {
        const destination = new Directory(currentDirectory, entry.value.name)
        if (destination.exists) throw new Error('Destination already exists')
        if (kind === 'copy') await entry.value.copy(destination)
        else await entry.value.move(destination)
      }
      setPendingOperation(null)
      setSelectedEntry(null)
      refresh()
    } catch (operationError) {
      showError(`Could not ${kind} item`, operationError)
    } finally {
      setBusy(false)
    }
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.centered}>
        <Ionicons name="folder-open-outline" size={46} color="#4a90d9" />
        <Text style={styles.webTitle}>Files are available in the mobile app</Text>
        <Text style={styles.webMessage}>
          Browser storage does not provide the same private app-folder access. Open Jarvis on Android or iOS to manage files safely.
        </Text>
      </View>
    )
  }

  const renderEntry = ({ item }: { item: Entry }) => {
    const directory = item.kind === 'directory'
    const size = directory ? item.value.size ?? 0 : item.value.size
    const canEdit = !directory && (
      TEXT_EXTENSIONS.has(item.value.extension.toLowerCase())
      || item.value.type.startsWith('text/')
    )

    return (
      <View style={styles.entryRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.entryMain}
          onPress={() => {
            if (directory) navigateTo(item.value)
            else if (canEdit) void beginEdit(item.value)
          }}
        >
          <Ionicons
            name={directory ? 'folder' : 'document-text-outline'}
            size={24}
            color={directory ? '#f0b84c' : '#4a90d9'}
          />
          <View style={styles.entryCopy}>
            <Text style={styles.entryName} numberOfLines={1}>{item.value.name}</Text>
            <Text style={styles.entryMeta}>{directory ? 'Folder' : `${displaySize(size)}${canEdit ? ' · Text' : ''}`}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${item.value.name}`}
          style={styles.moreButton}
          onPress={() => setSelectedEntry(item)}
        >
          <Ionicons name="ellipsis-vertical" size={20} color="#aaa" />
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>Files</Text>
          <Text style={styles.subtitle}>Private app storage</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.iconButton}>
          <Ionicons name="refresh" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.sandboxNotice}>
        <Ionicons name="lock-closed-outline" size={16} color="#72b7fa" />
        <Text style={styles.noticeText}>Only files in Jarvis storage are shown. No device-wide access.</Text>
      </View>

      <View style={styles.breadcrumbs}>
        {breadcrumbs.map((directory, index) => (
          <View key={directory.uri} style={styles.breadcrumbItem}>
            {index > 0 && <Ionicons name="chevron-forward" size={14} color="#777" />}
            <TouchableOpacity onPress={() => navigateTo(directory)}>
              <Text style={[styles.breadcrumbText, index === breadcrumbs.length - 1 && styles.currentBreadcrumb]}>
                {index === 0 ? 'Files' : directory.name}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setNameDialog({ kind: 'folder', value: '' })}
          disabled={!currentDirectory || busy}
        >
          <Ionicons name="folder-outline" size={18} color="#fff" />
          <Text style={styles.toolbarText}>Folder</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setNameDialog({ kind: 'file', value: '' })}
          disabled={!currentDirectory || busy}
        >
          <Ionicons name="document-outline" size={18} color="#fff" />
          <Text style={styles.toolbarText}>Text file</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolbarButton, (!pendingOperation || busy) && styles.disabledButton]}
          onPress={() => void pastePending()}
          disabled={!pendingOperation || busy}
        >
          <Ionicons name="clipboard-outline" size={18} color="#fff" />
          <Text style={styles.toolbarText}>Paste</Text>
        </TouchableOpacity>
      </View>

      {pendingOperation && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingText} numberOfLines={2}>
            {pendingOperation.kind === 'copy' ? 'Copying' : 'Moving'} “{pendingOperation.entry.value.name}” to {currentPath}
          </Text>
          <TouchableOpacity onPress={() => setPendingOperation(null)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4a90d9" />
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity onPress={refresh}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="folder-open-outline" size={38} color="#666" />
          <Text style={styles.emptyText}>This folder is empty.</Text>
          <Text style={styles.emptyHint}>Create a folder or text file to get started.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.value.uri}
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <Modal visible={nameDialog !== null} transparent animationType="fade" onRequestClose={() => setNameDialog(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              {nameDialog?.kind === 'folder' ? 'New folder' : nameDialog?.kind === 'file' ? 'New text file' : 'Rename'}
            </Text>
            <TextInput
              autoFocus
              value={nameDialog?.value ?? ''}
              onChangeText={(value) => setNameDialog((current) => current ? { ...current, value } : current)}
              placeholder={nameDialog?.kind === 'folder' ? 'Folder name' : nameDialog?.kind === 'file' ? 'notes.txt' : 'Name'}
              placeholderTextColor="#777"
              style={styles.input}
              maxLength={100}
              autoCapitalize="none"
              onSubmitEditing={submitNameDialog}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity onPress={() => setNameDialog(null)} style={styles.dialogButton}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitNameDialog} style={[styles.dialogButton, styles.primaryButton]}>
                <Text style={styles.primaryButtonText}>{nameDialog?.kind === 'rename' ? 'Rename' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editingFile !== null} animationType="slide" onRequestClose={() => setEditingFile(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editorContainer}>
          <View style={styles.editorHeader}>
            <TouchableOpacity onPress={() => setEditingFile(null)} style={styles.editorCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.editorTitle} numberOfLines={1}>{editingFile?.name}</Text>
            <TouchableOpacity onPress={saveText} disabled={busy} style={styles.saveButton}>
              <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            multiline
            value={editorText}
            onChangeText={setEditorText}
            style={styles.editorInput}
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={selectedEntry !== null} transparent animationType="fade" onRequestClose={() => setSelectedEntry(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedEntry(null)}>
          <Pressable style={styles.actionSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dialogTitle} numberOfLines={1}>{selectedEntry?.value.name}</Text>
            {selectedEntry?.kind === 'file' && (
              TEXT_EXTENSIONS.has(selectedEntry.value.extension.toLowerCase())
              || selectedEntry.value.type.startsWith('text/')
            ) && (
              <ActionButton icon="create-outline" label="Edit text" onPress={() => void beginEdit(selectedEntry.value)} />
            )}
            <ActionButton
              icon="pencil-outline"
              label="Rename"
              onPress={() => {
                if (!selectedEntry) return
                setNameDialog({ kind: 'rename', entry: selectedEntry, value: selectedEntry.value.name })
                setSelectedEntry(null)
              }}
            />
            <ActionButton
              icon="copy-outline"
              label="Copy"
              onPress={() => {
                if (selectedEntry) setPendingOperation({ kind: 'copy', entry: selectedEntry })
                setSelectedEntry(null)
              }}
            />
            <ActionButton
              icon="move-outline"
              label="Move"
              onPress={() => {
                if (selectedEntry) setPendingOperation({ kind: 'move', entry: selectedEntry })
                setSelectedEntry(null)
              }}
            />
            <ActionButton
              icon="trash-outline"
              label="Delete"
              destructive
              onPress={() => {
                if (selectedEntry) requestDelete(selectedEntry)
                setSelectedEntry(null)
              }}
            />
            <TouchableOpacity onPress={() => setSelectedEntry(null)} style={styles.sheetCancel}>
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function ActionButton({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  onPress: () => void
  destructive?: boolean
}) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Ionicons name={icon} size={20} color={destructive ? '#ef7777' : '#ddd'} />
      <Text style={[styles.actionText, destructive && styles.destructiveText]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingHorizontal: 18, paddingTop: 52 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#999', fontSize: 13, marginTop: 3 },
  iconButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  sandboxNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, backgroundColor: '#17283a', borderRadius: 10 },
  noticeText: { flex: 1, color: '#b8d7f2', fontSize: 12 },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginVertical: 15 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbText: { color: '#aaa', fontSize: 13 },
  currentBreadcrumb: { color: '#fff', fontWeight: '600' },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toolbarButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#242424', borderRadius: 10, paddingVertical: 11 },
  toolbarText: { color: '#eee', fontSize: 12, fontWeight: '600' },
  disabledButton: { opacity: 0.4 },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#202e3a', borderRadius: 9, padding: 11, marginBottom: 10 },
  pendingText: { flex: 1, color: '#c6e2fc', fontSize: 12 },
  cancelText: { color: '#bbb', fontSize: 14, fontWeight: '600' },
  loader: { flex: 1 },
  list: { paddingBottom: 28 },
  entryRow: { flexDirection: 'row', alignItems: 'center', minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#292929' },
  entryMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  entryCopy: { flex: 1 },
  entryName: { color: '#f2f2f2', fontSize: 15, fontWeight: '500' },
  entryMeta: { color: '#888', fontSize: 12, marginTop: 3 },
  moreButton: { padding: 10 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  emptyText: { color: '#bbb', fontSize: 15, textAlign: 'center' },
  emptyHint: { color: '#777', fontSize: 13, textAlign: 'center' },
  retryText: { color: '#72b7fa', fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212', padding: 28 },
  webTitle: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  webMessage: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 10 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.68)', padding: 22 },
  dialog: { width: '100%', maxWidth: 420, backgroundColor: '#202020', borderRadius: 16, padding: 20 },
  dialogTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 14 },
  input: { color: '#fff', backgroundColor: '#151515', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  dialogButton: { minWidth: 75, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  primaryButton: { borderRadius: 8, backgroundColor: '#2768a8' },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  editorContainer: { flex: 1, backgroundColor: '#121212', paddingTop: Platform.OS === 'ios' ? 54 : 26 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#292929' },
  editorCancel: { paddingVertical: 8 },
  editorTitle: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  saveButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: '#2768a8' },
  editorInput: { flex: 1, color: '#eee', padding: 16, fontSize: 15, lineHeight: 22 },
  actionSheet: { width: '100%', maxWidth: 440, backgroundColor: '#202020', borderRadius: 16, padding: 18 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333' },
  actionText: { color: '#eee', fontSize: 15 },
  destructiveText: { color: '#ef7777' },
  sheetCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 5, borderTopWidth: 1, borderTopColor: '#333' },
})
