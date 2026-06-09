import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Report {
  id: string;
  user_name: string;
  type: string;
  description: string;
  status: string;
  photos: string[];
  created_at: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  received: { label: 'Reçu', color: '#f59e0b', bgColor: '#fef3c7' },
  processing: { label: 'En traitement', color: '#6366f1', bgColor: '#e0e7ff' },
  resolved: { label: 'Résolu', color: '#10b981', bgColor: '#d1fae5' },
};

const TYPE_LABELS: Record<string, string> = {
  waste: 'Déchets sauvages',
  water: 'Problème d\'eau',
  drainage: 'Assainissement',
  street: 'Propreté de rue',
  other: 'Autre',
};

const STATUS_FILTERS = [
  { id: 'all', label: 'Tous', icon: 'apps' },
  { id: 'received', label: 'Reçus', icon: 'mail' },
  { id: 'processing', label: 'En cours', icon: 'hourglass' },
  { id: 'resolved', label: 'Résolus', icon: 'checkmark-circle' },
];

const TYPE_FILTERS = [
  { id: 'all', label: 'Tous types', icon: 'list' },
  { id: 'waste', label: 'Déchets', icon: 'trash' },
  { id: 'water', label: 'Eau', icon: 'water' },
  { id: 'drainage', label: 'Assainissement', icon: 'funnel' },
  { id: 'street', label: 'Rue', icon: 'car' },
  { id: 'other', label: 'Autre', icon: 'ellipsis-horizontal' },
];

export default function History() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/reports`);
      setReports(response.data);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (typeFilter !== 'all' && report.type !== typeFilter) return false;
      return true;
    });
  }, [reports, statusFilter, typeFilter]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const renderReport = ({ item }: { item: Report }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.received;

    return (
      <TouchableOpacity
        testID={`report-card-${item.id}`}
        style={styles.reportCard}
        onPress={() => router.push(`/report-detail/${item.id}`)}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportTitleContainer}>
            <Text style={styles.reportType}>{TYPE_LABELS[item.type] || item.type}</Text>
            {isAdmin && (
              <Text style={styles.reportUser}>{item.user_name}</Text>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <Text style={styles.reportDescription} numberOfLines={2}>
          {item.description}
        </Text>

        {item.photos.length > 0 && (
          <View style={styles.photoPreview}>
            <Image source={{ uri: item.photos[0] }} style={styles.thumbnail} />
            {item.photos.length > 1 && (
              <View style={styles.photoCount}>
                <Ionicons name="images" size={12} color="#ffffff" />
                <Text style={styles.photoCountText}>+{item.photos.length - 1}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.reportFooter}>
          <View style={styles.locationContainer}>
            <Ionicons name="location" size={14} color="#64748b" />
            <Text style={styles.locationText} numberOfLines={1}>
              {item.location.address || `${item.location.latitude.toFixed(4)}, ${item.location.longitude.toFixed(4)}`}
            </Text>
          </View>
          <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{isAdmin ? 'Tous les signalements' : 'Mes signalements'}</Text>
        <Text style={styles.subtitle}>
          {filteredReports.length} signalement{filteredReports.length > 1 ? 's' : ''}
        </Text>
      </View>

      {/* Status Filter Chips */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>Statut</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {STATUS_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.id}
              testID={`filter-status-${filter.id}`}
              style={[
                styles.chip,
                statusFilter === filter.id && styles.chipSelected,
              ]}
              onPress={() => setStatusFilter(filter.id)}
            >
              <Ionicons
                name={filter.icon as any}
                size={14}
                color={statusFilter === filter.id ? '#ffffff' : '#64748b'}
              />
              <Text
                style={[
                  styles.chipText,
                  statusFilter === filter.id && styles.chipTextSelected,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Type Filter Chips */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>Type</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {TYPE_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.id}
              testID={`filter-type-${filter.id}`}
              style={[
                styles.chip,
                typeFilter === filter.id && styles.chipSelected,
              ]}
              onPress={() => setTypeFilter(filter.id)}
            >
              <Ionicons
                name={filter.icon as any}
                size={14}
                color={typeFilter === filter.id ? '#ffffff' : '#64748b'}
              />
              <Text
                style={[
                  styles.chipText,
                  typeFilter === filter.id && styles.chipTextSelected,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredReports}
        renderItem={renderReport}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color="#cbd5e1" />
            <Text style={styles.emptyText}>Aucun signalement</Text>
            <Text style={styles.emptySubtext}>
              {statusFilter !== 'all' || typeFilter !== 'all'
                ? 'Essayez d\'autres filtres'
                : 'Commencez par créer votre premier signalement'}
            </Text>
          </View>
        }
      />
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
    padding: 24,
    paddingBottom: 16,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  filterSection: {
    backgroundColor: '#ffffff',
    paddingBottom: 12,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    paddingHorizontal: 24,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  chipRow: {
    paddingHorizontal: 24,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
    height: 36,
  },
  chipSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    fontSize: 13,
    color: '#64748b',
    marginLeft: 6,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  reportCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  reportTitleContainer: {
    flex: 1,
  },
  reportType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  reportUser: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reportDescription: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 20,
  },
  photoPreview: {
    position: 'relative',
    marginBottom: 12,
  },
  thumbnail: {
    width: '100%',
    height: 120,
    borderRadius: 8,
  },
  photoCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 4,
    flex: 1,
  },
  dateText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
