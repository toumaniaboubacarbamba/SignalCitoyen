import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

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
  created_at: string;
  location: { latitude: number; longitude: number; address?: string };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  assigned: { label: 'À traiter', color: '#6366f1', bgColor: '#e0e7ff', icon: 'flag' },
  processing: { label: 'En cours', color: '#0ea5e9', bgColor: '#e0f2fe', icon: 'hourglass' },
  resolved: { label: 'Résolu', color: '#10b981', bgColor: '#d1fae5', icon: 'checkmark-circle' },
  received: { label: 'En attente', color: '#f59e0b', bgColor: '#fef3c7', icon: 'mail' },
};

const TYPE_LABELS: Record<string, string> = {
  waste: 'Déchets sauvages',
  water: 'Problème d\'eau',
  drainage: 'Assainissement',
  street: 'Propreté de rue',
  other: 'Autre',
};

const TAB_FILTERS = [
  { id: 'pending', label: 'À traiter', statuses: ['assigned'] },
  { id: 'in_progress', label: 'En cours', statuses: ['processing'] },
  { id: 'done', label: 'Résolus', statuses: ['resolved'] },
];

export default function AgentScreen() {
  const router = useRouter();
  const { isAgent, user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');

  const loadReports = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/agent/reports`);
      setReports(response.data);
    } catch (error) {
      console.error('Erreur chargement reports agent:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAgent) loadReports();
    else setLoading(false);
  }, [isAgent]);

  useFocusEffect(
    useCallback(() => {
      if (isAgent) loadReports();
    }, [isAgent])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  if (!isAgent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="lock-closed" size={64} color="#cbd5e1" />
          <Text style={styles.emptyText}>Accès réservé aux agents</Text>
          <Text style={styles.emptySubtext}>
            Cet onglet est destiné aux équipes de terrain
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentFilter = TAB_FILTERS.find((t) => t.id === activeTab);
  const filteredReports = reports.filter((r) => currentFilter?.statuses.includes(r.status));

  // Compteurs par onglet
  const counts = {
    pending: reports.filter((r) => r.status === 'assigned').length,
    in_progress: reports.filter((r) => r.status === 'processing').length,
    done: reports.filter((r) => r.status === 'resolved').length,
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const renderReport = ({ item }: { item: Report }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.assigned;
    return (
      <TouchableOpacity
        testID={`agent-card-${item.id}`}
        style={[styles.card, item.priority === 'urgent_critique' && styles.urgentCard]}
        onPress={() => router.push(`/report-detail/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
            <Ionicons name={statusConfig.icon as any} size={14} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          {item.priority === 'urgent_critique' && (
            <View style={styles.urgentBadge}>
              <Ionicons name="warning" size={12} color="#ffffff" />
              <Text style={styles.urgentBadgeText}>URGENT</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardTitle}>{TYPE_LABELS[item.type] || item.type}</Text>
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>

        <View style={styles.cardFooter}>
          <View style={styles.cardRow}>
            <Ionicons name="location-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText} numberOfLines={1}>
              {item.location.address || `${item.location.latitude.toFixed(4)}, ${item.location.longitude.toFixed(4)}`}
            </Text>
          </View>
          <View style={styles.cardRow}>
            <Ionicons name="person-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText}>Citoyen : {item.user_name}</Text>
          </View>
          <View style={styles.cardRow}>
            <Ionicons name="time-outline" size={14} color="#64748b" />
            <Text style={styles.cardRowText}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        <View style={styles.actionHint}>
          <Text style={styles.actionHintText}>
            {item.status === 'assigned' && 'Appuyez pour démarrer l\'intervention →'}
            {item.status === 'processing' && 'Appuyez pour marquer comme résolu →'}
            {item.status === 'resolved' && 'Appuyez pour voir les détails →'}
          </Text>
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
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Mes interventions</Text>
          <View style={styles.teamRow}>
            <Ionicons name="people" size={14} color="#2563eb" />
            <Text style={styles.teamText}>{user?.team_id || 'Aucune équipe'}</Text>
          </View>
        </View>
        <View style={styles.agentBadge}>
          <Ionicons name="briefcase" size={14} color="#ffffff" />
          <Text style={styles.agentBadgeText}>AGENT</Text>
        </View>
      </View>

      {/* Onglets */}
      <View style={styles.tabsContainer}>
        {TAB_FILTERS.map((tab) => {
          const count = counts[tab.id as keyof typeof counts];
          return (
            <TouchableOpacity
              key={tab.id}
              testID={`agent-tab-${tab.id}`}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text
                style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}
              >
                {tab.label}
              </Text>
              {count > 0 && (
                <View
                  style={[
                    styles.tabBadge,
                    activeTab === tab.id && styles.tabBadgeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabBadgeText,
                      activeTab === tab.id && styles.tabBadgeTextActive,
                    ]}
                  >
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredReports}
        renderItem={renderReport}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color="#94a3b8" />
            </View>
            <Text style={styles.emptyText}>
              {activeTab === 'pending' && 'Aucune intervention à traiter'}
              {activeTab === 'in_progress' && 'Aucune intervention en cours'}
              {activeTab === 'done' && 'Aucune intervention résolue récemment'}
            </Text>
            <Text style={styles.emptySubtext}>
              {activeTab === 'pending' && 'Vous serez notifié dès qu\'un nouveau ticket sera assigné à votre équipe'}
              {activeTab === 'in_progress' && 'Démarrez une intervention depuis l\'onglet "À traiter"'}
              {activeTab === 'done' && 'Les résolus apparaissent ici 7 jours'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1e293b' },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  teamText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  agentBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: { backgroundColor: '#dbeafe' },
  tabText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  tabTextActive: { color: '#2563eb' },
  tabBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#cbd5e1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBadgeActive: { backgroundColor: '#2563eb' },
  tabBadgeText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
  tabBadgeTextActive: { color: '#ffffff' },
  listContent: { padding: 12, flexGrow: 1 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  urgentCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    backgroundColor: '#fffafa',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
  },
  urgentBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '700' },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 10,
  },
  cardFooter: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardRowText: { fontSize: 12, color: '#64748b', flex: 1 },
  actionHint: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  actionHintText: {
    fontSize: 11,
    color: '#2563eb',
    fontWeight: '600',
    textAlign: 'right',
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 17, fontWeight: '700', color: '#475569', marginBottom: 8, textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 18 },
});
