import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/src/contexts/AuthContext';
import * as ImagePicker from 'expo-image-picker';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width } = Dimensions.get('window');

interface Report {
  id: string;
  user_name: string;
  type: string;
  description: string;
  status: string;
  priority: string;
  team_id?: string;
  zone?: string;
  escalated?: boolean;
  photos: string[];
  proof_photos?: string[];
  admin_notes?: string;
  agent_notes?: string;
  resolved_by?: string;
  created_at: string;
  updated_at: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  received: { label: 'En attente', color: '#f59e0b', bgColor: '#fef3c7', icon: 'mail' },
  assigned: { label: 'Assigné', color: '#6366f1', bgColor: '#e0e7ff', icon: 'people' },
  processing: { label: 'En cours', color: '#0ea5e9', bgColor: '#e0f2fe', icon: 'hourglass' },
  resolved: { label: 'Résolu', color: '#10b981', bgColor: '#d1fae5', icon: 'checkmark-circle' },
};

const TYPE_LABELS: Record<string, string> = {
  waste: 'Déchets sauvages',
  water: 'Problème d\'eau',
  drainage: 'Assainissement',
  street: 'Propreté de rue',
  other: 'Autre',
};

export default function ReportDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { isAdmin, isAgent, user } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Edition des notes admin
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Actions agent
  const [actionLoading, setActionLoading] = useState(false);
  const [resolveMode, setResolveMode] = useState(false);
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);
  const [agentNotes, setAgentNotes] = useState('');

  // Action admin (rouvrir)
  const [reopenMode, setReopenMode] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  useEffect(() => {
    loadReport();
  }, [id]);

  const loadReport = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/reports/${id}`);
      setReport(response.data);
      setNotesValue(response.data.admin_notes || '');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger le signalement');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!report) return;

    setUpdating(true);
    try {
      const response = await axios.put(`${BACKEND_URL}/api/reports/${id}`, {
        status: newStatus,
      });
      setReport(response.data);
      Alert.alert('Succès', 'Statut mis à jour');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de mettre à jour le statut');
    } finally {
      setUpdating(false);
    }
  };

  const saveNotes = async () => {
    if (!report) return;

    setSavingNotes(true);
    try {
      const response = await axios.put(`${BACKEND_URL}/api/reports/${id}`, {
        admin_notes: notesValue.trim(),
      });
      setReport(response.data);
      setEditingNotes(false);
      Alert.alert('Succès', 'Notes enregistrées');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'enregistrer les notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleStatusUpdate = () => {
    if (!report) return;

    const statusOptions: any[] = [
      { text: 'Annuler', style: 'cancel' },
      { text: 'En attente', onPress: () => updateStatus('received') },
      { text: 'Assigné', onPress: () => updateStatus('assigned') },
      { text: 'En cours', onPress: () => updateStatus('processing') },
      { text: 'Résolu', onPress: () => updateStatus('resolved') },
    ];

    Alert.alert('Changer le statut', 'Sélectionnez le nouveau statut', statusOptions);
  };

  // ========== ACTIONS AGENT ==========

  const startIntervention = async () => {
    if (!report) return;
    setActionLoading(true);
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/reports/${id}/start-intervention`
      );
      setReport(response.data);
      Alert.alert('Intervention démarrée', 'Le citoyen est notifié que vous êtes en route.');
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Impossible de démarrer l\'intervention');
    } finally {
      setActionLoading(false);
    }
  };

  const takeProofPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'L\'accès à la caméra est requis pour les photos de preuve');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setProofPhotos([...proofPhotos, `data:image/jpeg;base64,${result.assets[0].base64}`]);
    }
  };

  const pickProofPhoto = async () => {
    const result = await ImagePicker.launchImagePickerAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setProofPhotos([...proofPhotos, `data:image/jpeg;base64,${result.assets[0].base64}`]);
    }
  };

  const removeProofPhoto = (index: number) => {
    setProofPhotos(proofPhotos.filter((_, i) => i !== index));
  };

  const submitResolution = async () => {
    if (proofPhotos.length === 0) {
      Alert.alert('Photos requises', 'Vous devez ajouter au moins une photo de preuve pour clore le ticket.');
      return;
    }
    setActionLoading(true);
    try {
      const response = await axios.post(`${BACKEND_URL}/api/reports/${id}/resolve`, {
        proof_photos: proofPhotos,
        agent_notes: agentNotes.trim() || null,
      });
      setReport(response.data);
      setResolveMode(false);
      setProofPhotos([]);
      setAgentNotes('');
      Alert.alert('Ticket résolu', 'Le citoyen a été notifié de la résolution.');
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Impossible de résoudre le ticket');
    } finally {
      setActionLoading(false);
    }
  };

  // ========== ACTION ADMIN ==========

  const submitReopen = async () => {
    if (!reopenReason.trim()) {
      Alert.alert('Raison requise', 'Veuillez expliquer pourquoi vous rouvrez ce ticket.');
      return;
    }
    setActionLoading(true);
    try {
      const response = await axios.post(`${BACKEND_URL}/api/reports/${id}/reopen`, {
        reason: reopenReason.trim(),
      });
      setReport(response.data);
      setReopenMode(false);
      setReopenReason('');
      Alert.alert('Ticket rouvert', 'L\'équipe et le citoyen ont été notifiés.');
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Impossible de rouvrir le ticket');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelEditNotes = () => {
    setNotesValue(report?.admin_notes || '');
    setEditingNotes(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return null;
  }

  const statusConfig = STATUS_CONFIG[report.status] || STATUS_CONFIG.received;
  const isUrgent = report.priority === 'urgent_critique';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1e293b" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Détails du signalement</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
          {/* Urgent banner */}
          {isUrgent && (
            <View style={styles.urgentBanner}>
              <Ionicons name="warning" size={20} color="#ffffff" />
              <Text style={styles.urgentBannerText}>
                {report.escalated ? 'ESCALADÉ - PRIORITÉ CRITIQUE' : 'PRIORITÉ URGENTE'}
              </Text>
            </View>
          )}

          <View style={styles.statusSection}>
            <View style={[styles.statusCard, { backgroundColor: statusConfig.bgColor }]}>
              <Ionicons name={statusConfig.icon as any} size={40} color={statusConfig.color} />
              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>Statut actuel</Text>
                <Text style={[styles.statusValue, { color: statusConfig.color }]}>
                  {statusConfig.label}
                </Text>
              </View>
            </View>

            {isAdmin && (
              <TouchableOpacity
                testID="update-status-button"
                style={styles.updateButton}
                onPress={handleStatusUpdate}
                disabled={updating}
              >
                {updating ? (
                  <ActivityIndicator color="#2563eb" />
                ) : (
                  <>
                    <Ionicons name="create-outline" size={20} color="#2563eb" />
                    <Text style={styles.updateButtonText}>Modifier le statut</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* ============ ACTIONS AGENT ============ */}
          {isAgent && report.team_id === user?.team_id && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Actions terrain</Text>

              {/* Action: Démarrer intervention */}
              {report.status === 'assigned' && (
                <TouchableOpacity
                  testID="start-intervention-button"
                  style={[styles.primaryAction, actionLoading && styles.buttonDisabled]}
                  onPress={startIntervention}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Ionicons name="play-circle" size={22} color="#ffffff" />
                      <Text style={styles.primaryActionText}>Démarrer l'intervention</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Action: Marquer comme résolu */}
              {report.status === 'processing' && !resolveMode && (
                <TouchableOpacity
                  testID="open-resolve-button"
                  style={styles.primaryAction}
                  onPress={() => setResolveMode(true)}
                >
                  <Ionicons name="checkmark-circle" size={22} color="#ffffff" />
                  <Text style={styles.primaryActionText}>Marquer comme résolu</Text>
                </TouchableOpacity>
              )}

              {/* Formulaire de résolution avec photos de preuve */}
              {report.status === 'processing' && resolveMode && (
                <View>
                  <Text style={styles.formLabel}>Photos de preuve *</Text>
                  <Text style={styles.formHint}>
                    Au moins une photo (avant/après) est requise
                  </Text>

                  <View style={styles.photoButtonsRow}>
                    <TouchableOpacity
                      testID="take-proof-photo"
                      style={styles.photoActionButton}
                      onPress={takeProofPhoto}
                    >
                      <Ionicons name="camera" size={20} color="#2563eb" />
                      <Text style={styles.photoActionText}>Prendre photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="pick-proof-photo"
                      style={styles.photoActionButton}
                      onPress={pickProofPhoto}
                    >
                      <Ionicons name="images" size={20} color="#2563eb" />
                      <Text style={styles.photoActionText}>Galerie</Text>
                    </TouchableOpacity>
                  </View>

                  {proofPhotos.length > 0 && (
                    <View style={styles.proofGrid}>
                      {proofPhotos.map((p, idx) => (
                        <View key={idx} style={styles.proofItem}>
                          <Image source={{ uri: p }} style={styles.proofImg} />
                          <TouchableOpacity
                            style={styles.removeBtn}
                            onPress={() => removeProofPhoto(idx)}
                          >
                            <Ionicons name="close-circle" size={22} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  <Text style={[styles.formLabel, { marginTop: 16 }]}>
                    Notes (optionnel)
                  </Text>
                  <TextInput
                    testID="agent-notes-input"
                    style={styles.notesInput}
                    value={agentNotes}
                    onChangeText={setAgentNotes}
                    placeholder="Décrivez l'intervention réalisée..."
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />

                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setResolveMode(false);
                        setProofPhotos([]);
                        setAgentNotes('');
                      }}
                      disabled={actionLoading}
                    >
                      <Text style={styles.cancelButtonText}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="submit-resolution-button"
                      style={[styles.successAction, actionLoading && styles.buttonDisabled]}
                      onPress={submitResolution}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="checkmark" size={18} color="#ffffff" />
                          <Text style={styles.saveButtonText}>Valider la résolution</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {report.status === 'resolved' && (
                <View style={styles.resolvedBanner}>
                  <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                  <Text style={styles.resolvedText}>
                    Vous avez résolu ce ticket. Le citoyen est notifié.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ============ ACTION ADMIN : ROUVRIR ============ */}
          {isAdmin && report.status === 'resolved' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Action administrateur</Text>
              {!reopenMode ? (
                <TouchableOpacity
                  testID="open-reopen-button"
                  style={styles.warningAction}
                  onPress={() => setReopenMode(true)}
                >
                  <Ionicons name="refresh-circle" size={22} color="#ffffff" />
                  <Text style={styles.primaryActionText}>Rouvrir ce ticket</Text>
                </TouchableOpacity>
              ) : (
                <View>
                  <Text style={styles.formLabel}>Raison de la réouverture *</Text>
                  <TextInput
                    testID="reopen-reason-input"
                    style={styles.notesInput}
                    value={reopenReason}
                    onChangeText={setReopenReason}
                    placeholder="Ex: Le citoyen signale que le problème n'est pas résolu, photos de preuve insuffisantes..."
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setReopenMode(false);
                        setReopenReason('');
                      }}
                      disabled={actionLoading}
                    >
                      <Text style={styles.cancelButtonText}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="submit-reopen-button"
                      style={[styles.warningAction, actionLoading && styles.buttonDisabled, { flex: 1 }]}
                      onPress={submitReopen}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="refresh" size={18} color="#ffffff" />
                          <Text style={styles.saveButtonText}>Confirmer réouverture</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations</Text>

            <View style={styles.infoRow}>
              <View style={styles.infoLabel}>
                <Ionicons name="alert-circle-outline" size={20} color="#64748b" />
                <Text style={styles.infoLabelText}>Type</Text>
              </View>
              <Text style={styles.infoValue}>{TYPE_LABELS[report.type] || report.type}</Text>
            </View>

            {isAdmin && (
              <View style={styles.infoRow}>
                <View style={styles.infoLabel}>
                  <Ionicons name="person-outline" size={20} color="#64748b" />
                  <Text style={styles.infoLabelText}>Signalé par</Text>
                </View>
                <Text style={styles.infoValue}>{report.user_name}</Text>
              </View>
            )}

            {report.team_id && (
              <View style={styles.infoRow}>
                <View style={styles.infoLabel}>
                  <Ionicons name="people-outline" size={20} color="#64748b" />
                  <Text style={styles.infoLabelText}>Équipe assignée</Text>
                </View>
                <Text style={[styles.infoValue, styles.teamId]} numberOfLines={1}>
                  {report.team_id}
                </Text>
              </View>
            )}

            {report.zone && (
              <View style={styles.infoRow}>
                <View style={styles.infoLabel}>
                  <Ionicons name="navigate-outline" size={20} color="#64748b" />
                  <Text style={styles.infoLabelText}>Zone</Text>
                </View>
                <Text style={styles.infoValue}>{report.zone}</Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <View style={styles.infoLabel}>
                <Ionicons name="calendar-outline" size={20} color="#64748b" />
                <Text style={styles.infoLabelText}>Date de création</Text>
              </View>
              <Text style={styles.infoValue}>{formatDate(report.created_at)}</Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoLabel}>
                <Ionicons name="time-outline" size={20} color="#64748b" />
                <Text style={styles.infoLabelText}>Dernière mise à jour</Text>
              </View>
              <Text style={styles.infoValue}>{formatDate(report.updated_at)}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{report.description}</Text>
          </View>

          {report.photos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Photos ({report.photos.length})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.photosContainer}>
                  {report.photos.map((photo, index) => (
                    <Image key={index} source={{ uri: photo }} style={styles.photo} />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Photos de preuve agent (à la résolution) */}
          {report.proof_photos && report.proof_photos.length > 0 && (
            <View style={styles.section}>
              <View style={styles.notesHeader}>
                <Text style={styles.sectionTitle}>
                  Preuve de résolution ({report.proof_photos.length})
                </Text>
                {report.resolved_by && (
                  <View style={styles.resolvedByBadge}>
                    <Ionicons name="person" size={12} color="#065f46" />
                    <Text style={styles.resolvedByText}>{report.resolved_by}</Text>
                  </View>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.photosContainer}>
                  {report.proof_photos.map((photo, index) => (
                    <Image key={index} source={{ uri: photo }} style={styles.photo} />
                  ))}
                </View>
              </ScrollView>
              {report.agent_notes && (
                <View style={styles.agentNotesCard}>
                  <Ionicons name="document-text-outline" size={18} color="#0369a1" />
                  <Text style={styles.agentNotesText}>{report.agent_notes}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Localisation</Text>
            <View style={styles.locationCard}>
              <Ionicons name="location" size={24} color="#2563eb" />
              <View style={styles.locationInfo}>
                {report.location.address ? (
                  <Text style={styles.locationAddress}>{report.location.address}</Text>
                ) : null}
                <Text style={styles.locationCoords}>
                  {report.location.latitude.toFixed(6)}, {report.location.longitude.toFixed(6)}
                </Text>
              </View>
            </View>
          </View>

          {/* ====== NOTES ADMIN (CITOYEN: lecture seule | ADMIN: édition) ====== */}
          {(report.admin_notes || isAdmin) && (
            <View style={styles.section}>
              <View style={styles.notesHeader}>
                <Text style={styles.sectionTitle}>
                  {isAdmin ? 'Notes administrateur' : 'Notes de l\'administrateur'}
                </Text>
                {isAdmin && !editingNotes && (
                  <TouchableOpacity
                    testID="edit-notes-button"
                    style={styles.editIconButton}
                    onPress={() => setEditingNotes(true)}
                  >
                    <Ionicons
                      name={report.admin_notes ? 'create-outline' : 'add-circle-outline'}
                      size={22}
                      color="#2563eb"
                    />
                    <Text style={styles.editIconText}>
                      {report.admin_notes ? 'Modifier' : 'Ajouter'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {editingNotes ? (
                <View>
                  <TextInput
                    testID="admin-notes-input"
                    style={styles.notesInput}
                    value={notesValue}
                    onChangeText={setNotesValue}
                    placeholder="Ajoutez des notes internes sur ce signalement (visibles par tous les admins et le citoyen)..."
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    maxLength={1000}
                  />
                  <Text style={styles.charCount}>{notesValue.length}/1000 caractères</Text>
                  <View style={styles.notesActions}>
                    <TouchableOpacity
                      testID="cancel-notes-button"
                      style={styles.cancelButton}
                      onPress={cancelEditNotes}
                      disabled={savingNotes}
                    >
                      <Text style={styles.cancelButtonText}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="save-notes-button"
                      style={[styles.saveButton, savingNotes && styles.buttonDisabled]}
                      onPress={saveNotes}
                      disabled={savingNotes}
                    >
                      {savingNotes ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="checkmark" size={18} color="#ffffff" />
                          <Text style={styles.saveButtonText}>Enregistrer</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : report.admin_notes ? (
                <View style={styles.adminNotesCard}>
                  <Ionicons name="document-text" size={18} color="#92400e" />
                  <Text style={styles.adminNotes}>{report.admin_notes}</Text>
                </View>
              ) : (
                <View style={styles.emptyNotesCard}>
                  <Ionicons name="document-text-outline" size={32} color="#cbd5e1" />
                  <Text style={styles.emptyNotesText}>
                    Aucune note pour le moment
                  </Text>
                  <Text style={styles.emptyNotesSubtext}>
                    Cliquez sur "Ajouter" pour créer une note interne
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  scrollView: {
    flex: 1,
  },
  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    gap: 8,
  },
  urgentBannerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusSection: {
    padding: 24,
    backgroundColor: '#ffffff',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 12,
  },
  statusInfo: {
    marginLeft: 16,
  },
  statusLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    padding: 14,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  updateButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
    marginLeft: 8,
  },
  section: {
    padding: 24,
    backgroundColor: '#ffffff',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  infoLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabelText: {
    fontSize: 14,
    color: '#64748b',
    marginLeft: 8,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  teamId: {
    color: '#2563eb',
    fontSize: 12,
  },
  description: {
    fontSize: 16,
    color: '#1e293b',
    lineHeight: 24,
  },
  photosContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  photo: {
    width: width - 96,
    height: 240,
    borderRadius: 12,
  },
  locationCard: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  locationInfo: {
    flex: 1,
    marginLeft: 12,
  },
  locationAddress: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  locationCoords: {
    fontSize: 14,
    color: '#64748b',
  },
  // ====== NOTES ADMIN STYLES ======
  notesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  editIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
  },
  editIconText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  notesInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1e293b',
    minHeight: 120,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 6,
  },
  notesActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cancelButtonText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  adminNotesCard: {
    flexDirection: 'row',
    backgroundColor: '#fef3c7',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    gap: 10,
  },
  adminNotes: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    lineHeight: 22,
  },
  emptyNotesCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
  },
  emptyNotesText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 8,
  },
  emptyNotesSubtext: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    textAlign: 'center',
  },
  // ====== ACTIONS AGENT/ADMIN STYLES ======
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
  },
  successAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    flex: 1,
  },
  warningAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  formHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 12,
  },
  photoButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  photoActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#dbeafe',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  photoActionText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  proofGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  proofItem: {
    width: 90,
    height: 90,
    position: 'relative',
  },
  proofImg: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  resolvedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#d1fae5',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  resolvedText: {
    flex: 1,
    fontSize: 14,
    color: '#065f46',
    fontWeight: '600',
  },
  resolvedByBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#d1fae5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  resolvedByText: {
    fontSize: 11,
    color: '#065f46',
    fontWeight: '700',
  },
  agentNotesCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#e0f2fe',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  agentNotesText: {
    flex: 1,
    fontSize: 13,
    color: '#0369a1',
    lineHeight: 18,
  },
});
