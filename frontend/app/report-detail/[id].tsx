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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width } = Dimensions.get('window');

interface Report {
  id: string;
  user_name: string;
  type: string;
  description: string;
  status: string;
  photos: string[];
  admin_notes?: string;
  created_at: string;
  updated_at: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  received: { label: 'Reçu', color: '#f59e0b', bgColor: '#fef3c7', icon: 'mail' },
  processing: { label: 'En traitement', color: '#6366f1', bgColor: '#e0e7ff', icon: 'hourglass' },
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
  const { isAdmin } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadReport();
  }, [id]);

  const loadReport = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/reports/${id}`);
      setReport(response.data);
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
      await axios.put(`${BACKEND_URL}/api/reports/${id}`, {
        status: newStatus,
      });

      setReport({ ...report, status: newStatus, updated_at: new Date().toISOString() });
      Alert.alert('Succès', 'Statut mis à jour');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de mettre à jour le statut');
    } finally {
      setUpdating(false);
    }
  };

  const handleStatusUpdate = () => {
    if (!report) return;

    const statusOptions = [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Reçu', onPress: () => updateStatus('received') },
      { text: 'En traitement', onPress: () => updateStatus('processing') },
      { text: 'Résolu', onPress: () => updateStatus('resolved') },
    ];

    Alert.alert('Changer le statut', 'Sélectionnez le nouveau statut', statusOptions);
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1e293b" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Détails du signalement</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView}>
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

        {report.admin_notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes de l'administrateur</Text>
            <View style={styles.adminNotesCard}>
              <Text style={styles.adminNotes}>{report.admin_notes}</Text>
            </View>
          </View>
        )}
      </ScrollView>
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
  adminNotesCard: {
    backgroundColor: '#fef3c7',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  adminNotes: {
    fontSize: 14,
    color: '#92400e',
    lineHeight: 20,
  },
});
