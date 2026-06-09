import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Report {
  id: string;
  user_id: string;
  user_name: string;
  type: string;
  description: string;
  status: string;
  priority: string;
  team_id?: string;
  zone?: string;
  escalated: boolean;
  photos: string[];
  created_at: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

interface Stats {
  total: number;
  received: number;
  assigned: number;
  processing: number;
  resolved: number;
  urgent: number;
  escalated: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  received: { label: 'En attente', color: '#f59e0b', bgColor: '#fef3c7' },
  assigned: { label: 'Assigné', color: '#6366f1', bgColor: '#e0e7ff' },
  processing: { label: 'En cours', color: '#0ea5e9', bgColor: '#e0f2fe' },
  resolved: { label: 'Résolu', color: '#10b981', bgColor: '#d1fae5' },
};

const TYPE_LABELS: Record<string, string> = {
  waste: 'Déchets',
  water: 'Eau',
  drainage: 'Assainissement',
  street: 'Voirie',
  other: 'Autre',
};

const STATUS_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'received', label: 'En attente' },
  { id: 'assigned', label: 'Assignés' },
  { id: 'processing', label: 'En cours' },
  { id: 'resolved', label: 'Résolus' },
];

export default function AdminDashboard() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 768; // Tablette/Desktop

  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [reportsRes, statsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/reports`),
        axios.get(`${BACKEND_URL}/api/reports/stats/summary`),
      ]);
      setReports(reportsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Error loading admin data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (showUrgentOnly && r.priority !== 'urgent_critique') return false;
      return true;
    });
  }, [reports, statusFilter, showUrgentOnly]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  };

  const shortId = (id: string) => id.slice(-8).toUpperCase();

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="lock-closed" size={64} color="#cbd5e1" />
          <Text style={styles.emptyText}>Accès réservé</Text>
          <Text style={styles.emptySubtext}>
            Cette page est réservée aux administrateurs
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </SafeAreaView>
    );
  }

  // Render row pour table (desktop/tablette)
  const renderTableRow = (item: Report) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.received;
    return (
      <View
        key={item.id}
        testID={`admin-row-${item.id}`}
        style={[
          styles.tableRow,
          item.priority === 'urgent_critique' && styles.urgentRow,
        ]}
      >
        <View style={[styles.cell, styles.cellId]}>
          <Text style={styles.cellText}>#{shortId(item.id)}</Text>
          {item.escalated && (
            <View style={styles.escalatedBadge}>
              <Ionicons name="warning" size={10} color="#dc2626" />
            </View>
          )}
        </View>
        <View style={[styles.cell, styles.cellDate]}>
          <Text style={styles.cellText}>{formatDate(item.created_at)}</Text>
        </View>
        <View style={[styles.cell, styles.cellType]}>
          <Text style={styles.cellText}>{TYPE_LABELS[item.type] || item.type}</Text>
        </View>
        <View style={[styles.cell, styles.cellPlace]}>
          <Text style={styles.cellText} numberOfLines={1}>
            {item.location.address || 'N/A'}
          </Text>
          {item.zone && (
            <Text style={styles.cellSubtext}>{item.zone}</Text>
          )}
        </View>
        <View style={[styles.cell, styles.cellStatus]}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>
        <View style={[styles.cell, styles.cellActions]}>
          <TouchableOpacity
            testID={`admin-details-${item.id}`}
            style={styles.detailsButton}
            onPress={() => router.push(`/report-detail/${item.id}`)}
          >
            <Ionicons name="eye" size={14} color="#ffffff" />
            <Text style={styles.detailsButtonText}>Détails</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Render card pour mobile
  const renderMobileCard = (item: Report) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.received;
    return (
      <TouchableOpacity
        key={item.id}
        testID={`admin-card-${item.id}`}
        style={[
          styles.mobileCard,
          item.priority === 'urgent_critique' && styles.urgentCard,
        ]}
        onPress={() => router.push(`/report-detail/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardId}>#{shortId(item.id)}</Text>
            {item.escalated && (
              <View style={styles.urgentBadge}>
                <Ionicons name="warning" size={12} color="#ffffff" />
                <Text style={styles.urgentBadgeText}>URGENT</Text>
              </View>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardRow}>
            <Ionicons name="alert-circle-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText}>
              {TYPE_LABELS[item.type] || item.type}
            </Text>
          </View>
          <View style={styles.cardRow}>
            <Ionicons name="location-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText} numberOfLines={1}>
              {item.location.address || `${item.location.latitude.toFixed(4)}, ${item.location.longitude.toFixed(4)}`}
            </Text>
          </View>
          {item.team_id && (
            <View style={styles.cardRow}>
              <Ionicons name="people-outline" size={14} color="#64748b" />
              <Text style={styles.cardRowText} numberOfLines={1}>
                {item.team_id}
              </Text>
            </View>
          )}
          <View style={styles.cardRow}>
            <Ionicons name="calendar-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        <TouchableOpacity
          testID={`admin-details-mobile-${item.id}`}
          style={styles.detailsButtonFull}
          onPress={() => router.push(`/report-detail/${item.id}`)}
        >
          <Ionicons name="eye" size={16} color="#ffffff" />
          <Text style={styles.detailsButtonText}>Voir détails</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Tableau de bord</Text>
            <Text style={styles.subtitle}>Gestion des signalements</Text>
          </View>
          <View style={styles.adminBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#ffffff" />
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        </View>

        {/* Stats Cards */}
        {stats && (
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: '#dbeafe' }]}>
              <Ionicons name="list" size={24} color="#2563eb" />
              <Text style={styles.statNumber}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#fef3c7' }]}>
              <Ionicons name="mail" size={24} color="#f59e0b" />
              <Text style={styles.statNumber}>{stats.received}</Text>
              <Text style={styles.statLabel}>En attente</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#e0e7ff' }]}>
              <Ionicons name="people" size={24} color="#6366f1" />
              <Text style={styles.statNumber}>{stats.assigned}</Text>
              <Text style={styles.statLabel}>Assignés</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#d1fae5' }]}>
              <Ionicons name="checkmark-circle" size={24} color="#10b981" />
              <Text style={styles.statNumber}>{stats.resolved}</Text>
              <Text style={styles.statLabel}>Résolus</Text>
            </View>
            {stats.urgent > 0 && (
              <View style={[styles.statCard, { backgroundColor: '#fee2e2' }]}>
                <Ionicons name="warning" size={24} color="#dc2626" />
                <Text style={[styles.statNumber, { color: '#dc2626' }]}>{stats.urgent}</Text>
                <Text style={[styles.statLabel, { color: '#dc2626' }]}>Urgents</Text>
              </View>
            )}
            {stats.escalated > 0 && (
              <View style={[styles.statCard, { backgroundColor: '#fecaca' }]}>
                <Ionicons name="alert-circle" size={24} color="#b91c1c" />
                <Text style={[styles.statNumber, { color: '#b91c1c' }]}>{stats.escalated}</Text>
                <Text style={[styles.statLabel, { color: '#b91c1c' }]}>Escaladés</Text>
              </View>
            )}
          </View>
        )}

        {/* Filters */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Filtrer par statut</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {STATUS_FILTERS.map((filter) => (
              <TouchableOpacity
                key={filter.id}
                testID={`admin-filter-${filter.id}`}
                style={[styles.chip, statusFilter === filter.id && styles.chipSelected]}
                onPress={() => setStatusFilter(filter.id)}
              >
                <Text
                  style={[styles.chipText, statusFilter === filter.id && styles.chipTextSelected]}
                >
                  {filter.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              testID="admin-filter-urgent"
              style={[
                styles.chip,
                showUrgentOnly && { backgroundColor: '#dc2626', borderColor: '#dc2626' },
              ]}
              onPress={() => setShowUrgentOnly(!showUrgentOnly)}
            >
              <Ionicons
                name="warning"
                size={12}
                color={showUrgentOnly ? '#ffffff' : '#dc2626'}
              />
              <Text
                style={[
                  styles.chipText,
                  { marginLeft: 4 },
                  showUrgentOnly && { color: '#ffffff', fontWeight: '600' },
                ]}
              >
                Urgents uniquement
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Table ou Cards selon la taille */}
        <View style={styles.tableContainer}>
          <Text style={styles.tableTitle}>
            Signalements ({filteredReports.length})
          </Text>

          {filteredReports.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>Aucun signalement</Text>
            </View>
          ) : isWideScreen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={true}>
              <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                  <Text style={[styles.headerCell, styles.cellId]}>ID</Text>
                  <Text style={[styles.headerCell, styles.cellDate]}>Date</Text>
                  <Text style={[styles.headerCell, styles.cellType]}>Type</Text>
                  <Text style={[styles.headerCell, styles.cellPlace]}>Lieu</Text>
                  <Text style={[styles.headerCell, styles.cellStatus]}>Statut</Text>
                  <Text style={[styles.headerCell, styles.cellActions]}>Actions</Text>
                </View>
                {/* Rows */}
                {filteredReports.map(renderTableRow)}
              </View>
            </ScrollView>
          ) : (
            <View>{filteredReports.map(renderMobileCard)}</View>
          )}
        </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 16,
  },
  statCard: {
    flex: 1,
    minWidth: '30%',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  filterSection: {
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    marginTop: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  chipRow: {
    paddingHorizontal: 20,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
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
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  tableContainer: {
    backgroundColor: '#ffffff',
    marginTop: 8,
    padding: 16,
  },
  tableTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  // Table styles (wide screens)
  table: {
    minWidth: 800,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  headerCell: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
  },
  urgentRow: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },
  cell: {
    paddingHorizontal: 4,
  },
  cellText: {
    fontSize: 13,
    color: '#1e293b',
  },
  cellSubtext: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  cellId: { width: 100, flexDirection: 'row', alignItems: 'center' },
  cellDate: { width: 90 },
  cellType: { width: 120 },
  cellPlace: { width: 200 },
  cellStatus: { width: 110 },
  cellActions: { width: 110 },
  escalatedBadge: {
    marginLeft: 4,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  detailsButtonFull: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  detailsButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  // Mobile card styles
  mobileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  urgentCard: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    borderColor: '#fecaca',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardId: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  urgentBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    marginLeft: 3,
  },
  cardBody: {
    gap: 8,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardRowText: {
    fontSize: 13,
    color: '#475569',
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
