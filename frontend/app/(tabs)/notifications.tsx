import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Notification {
  id: string;
  report_id: string;
  title: string;
  message: string;
  status: string;
  read: boolean;
  created_at: string;
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  received: { icon: 'mail', color: '#f59e0b' },
  assigned: { icon: 'people', color: '#6366f1' },
  processing: { icon: 'hourglass', color: '#0ea5e9' },
  resolved: { icon: 'checkmark-circle', color: '#10b981' },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/notifications`);
      setNotifications(response.data);
    } catch (error) {
      console.error('Erreur chargement notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  // Recharger à chaque retour sur l'écran
  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const handleNotificationTap = async (notif: Notification) => {
    // Marquer comme lue (optimiste)
    if (!notif.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
      try {
        await axios.post(`${BACKEND_URL}/api/notifications/${notif.id}/read`);
      } catch (e) {
        // Si échec, on garde quand même l'UI optimiste
      }
    }
    // Navigation vers le ticket
    router.push(`/report-detail/${notif.report_id}` as any);
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await axios.post(`${BACKEND_URL}/api/notifications/read-all`);
    } catch (e) {
      console.warn('Erreur mark all read:', e);
    }
  };

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'À l\'instant';
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const renderNotification = ({ item }: { item: Notification }) => {
    const statusInfo = STATUS_ICONS[item.status] || STATUS_ICONS.received;
    return (
      <TouchableOpacity
        testID={`notif-card-${item.id}`}
        style={[styles.notifCard, !item.read && styles.notifCardUnread]}
        onPress={() => handleNotificationTap(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${statusInfo.color}20` }]}>
          <Ionicons name={statusInfo.icon as any} size={22} color={statusInfo.color} />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text
              style={[styles.notifTitle, !item.read && styles.notifTitleUnread]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.notifMessage} numberOfLines={2}>
            {item.message}
          </Text>
          <Text style={styles.notifDate}>{formatRelativeDate(item.created_at)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
      </TouchableOpacity>
    );
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>
            {unreadCount > 0
              ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
              : 'Toutes les notifications lues'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            testID="mark-all-read-button"
            style={styles.markAllButton}
            onPress={markAllAsRead}
          >
            <Ionicons name="checkmark-done" size={16} color="#2563eb" />
            <Text style={styles.markAllText}>Tout lire</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-off-outline" size={48} color="#94a3b8" />
            </View>
            <Text style={styles.emptyText}>Aucune notification</Text>
            <Text style={styles.emptySubtext}>
              {isAdmin
                ? 'Les notifications sont destinées aux citoyens.\nVos signalements généreront des notifications ici.'
                : 'Vous recevrez ici les mises à jour de vos signalements en temps réel.'}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#dbeafe',
    borderRadius: 8,
  },
  markAllText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  listContent: {
    padding: 12,
    flexGrow: 1,
  },
  notifCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  notifCardUnread: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  notifTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  notifTitleUnread: {
    color: '#1e293b',
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
  },
  notifMessage: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 4,
  },
  notifDate: {
    fontSize: 11,
    color: '#94a3b8',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
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
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },
});
