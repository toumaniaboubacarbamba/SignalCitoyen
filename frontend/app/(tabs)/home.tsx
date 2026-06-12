import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { useRouter } from 'expo-router';
import axios from 'axios';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Stats {
  total: number;
  received: number;
  processing: number;
  resolved: number;
}

export default function Home() {
  const { user, isAdmin, isAgent, isCitizen } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    try {
      const response = await axios.get(`${BACKEND_URL}/api/reports/stats/summary`);
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadStats();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Bonjour,</Text>
            <Text style={styles.userName}>{user?.name}</Text>
          </View>
          <View style={styles.iconContainer}>
            <Ionicons name="water" size={40} color="#2563eb" />
          </View>
        </View>

        {isAdmin && (
          <View style={styles.adminSection}>
            <Text style={styles.sectionTitle}>Tableau de bord</Text>
            {loading ? (
              <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 20 }} />
            ) : stats ? (
              <View style={styles.statsGrid}>
                <View style={[styles.statCard, { backgroundColor: '#dbeafe' }]}>
                  <Ionicons name="list" size={32} color="#2563eb" />
                  <Text style={styles.statNumber}>{stats.total}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: '#fef3c7' }]}>
                  <Ionicons name="mail" size={32} color="#f59e0b" />
                  <Text style={styles.statNumber}>{stats.received}</Text>
                  <Text style={styles.statLabel}>Reçus</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: '#e0e7ff' }]}>
                  <Ionicons name="hourglass" size={32} color="#6366f1" />
                  <Text style={styles.statNumber}>{stats.processing}</Text>
                  <Text style={styles.statLabel}>En traitement</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: '#d1fae5' }]}>
                  <Ionicons name="checkmark-circle" size={32} color="#10b981" />
                  <Text style={styles.statNumber}>{stats.resolved}</Text>
                  <Text style={styles.statLabel}>Résolus</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions rapides</Text>

          {isCitizen && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(tabs)/new-report')}
              testID="quick-action-new-report"
            >
              <View style={styles.actionIcon}>
                <Ionicons name="add-circle" size={32} color="#2563eb" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Nouveau signalement</Text>
                <Text style={styles.actionDescription}>
                  Signalez un problème de salubrité
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#cbd5e1" />
            </TouchableOpacity>
          )}

          {isCitizen && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(tabs)/history')}
            >
              <View style={styles.actionIcon}>
                <Ionicons name="time" size={32} color="#10b981" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Mes signalements</Text>
                <Text style={styles.actionDescription}>
                  Consultez l'historique de vos signalements
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#cbd5e1" />
            </TouchableOpacity>
          )}

          {isAgent && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(tabs)/agent')}
              testID="quick-action-interventions"
            >
              <View style={[styles.actionIcon, { backgroundColor: '#ede9fe' }]}>
                <Ionicons name="briefcase" size={32} color="#7c3aed" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Mes interventions</Text>
                <Text style={styles.actionDescription}>
                  Voir les tickets de votre équipe
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#cbd5e1" />
            </TouchableOpacity>
          )}

          {isAdmin && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(tabs)/admin')}
              testID="quick-action-admin"
            >
              <View style={styles.actionIcon}>
                <Ionicons name="grid" size={32} color="#2563eb" />
              </View>
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Tableau de bord admin</Text>
                <Text style={styles.actionDescription}>
                  Gérer tous les signalements
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={24} color="#2563eb" />
            <Text style={styles.infoText}>
              Contribuez à améliorer la salubrité, l'eau et l'assainissement en Côte d'Ivoire
            </Text>
          </View>
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
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  greeting: {
    fontSize: 16,
    color: '#64748b',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 4,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminSection: {
    padding: 24,
    backgroundColor: '#ffffff',
    marginTop: 8,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionContent: {
    flex: 1,
    marginLeft: 16,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 14,
    color: '#64748b',
  },
  infoSection: {
    padding: 24,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#dbeafe',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#1e40af',
    lineHeight: 20,
  },
});
