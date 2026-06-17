import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Dynamically import WebView only on native to avoid web error
let WebView: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebView = require('react-native-webview').WebView;
}

interface Report {
  id: string;
  user_name: string;
  type: string;
  description: string;
  status: string;
  created_at: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

const STATUS_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'received', label: 'Reçus' },
  { id: 'assigned', label: 'Assignés' },
  { id: 'processing', label: 'En cours' },
  { id: 'resolved', label: 'Résolus' },
];

const STATUS_COLORS: Record<string, string> = {
  received: '#f59e0b',
  assigned: '#6366f1',
  processing: '#0ea5e9',
  resolved: '#10b981',
};

const TYPE_LABELS: Record<string, string> = {
  waste: 'Déchets',
  water: 'Eau',
  drainage: 'Assainissement',
  street: 'Rue',
  other: 'Autre',
};

export default function MapScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

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
    }
  };

  const filteredReports = useMemo(() => {
    if (statusFilter === 'all') return reports;
    return reports.filter((r) => r.status === statusFilter);
  }, [reports, statusFilter]);

  const mapHTML = useMemo(() => {
    let centerLat = 5.3599;
    let centerLng = -4.0083;

    if (filteredReports.length > 0) {
      centerLat = filteredReports[0].location.latitude;
      centerLng = filteredReports[0].location.longitude;
    }

    const markersJS = filteredReports
      .map((r) => {
        const color = STATUS_COLORS[r.status] || '#64748b';
        const typeLabel = TYPE_LABELS[r.type] || r.type;
        const safeDescription = r.description.replace(/'/g, "\\'").replace(/"/g, '\\"').substring(0, 100);
        return `
          (function() {
            var icon = L.divIcon({
              html: '<div style="background-color:${color};width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;">!</div>',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
              className: ''
            });
            var marker = L.marker([${r.location.latitude}, ${r.location.longitude}], { icon: icon }).addTo(map);
            marker.bindPopup('<div style="font-family:sans-serif;min-width:180px;"><div style="font-weight:bold;font-size:14px;color:#1e293b;margin-bottom:4px;">${typeLabel}</div><div style="font-size:12px;color:#64748b;margin-bottom:8px;">${safeDescription}...</div><button onclick="navigateToReport(\\'${r.id}\\')" style="background:#2563eb;color:white;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;width:100%;">Voir détails</button></div>');
          })();
        `;
      })
      .join('\n');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    body { margin: 0; padding: 0; }
    #map { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map').setView([${centerLat}, ${centerLng}], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    function navigateToReport(id) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(id);
      } else {
        window.parent.postMessage({ type: 'report_click', id: id }, '*');
      }
    }
    ${markersJS}
  </script>
</body>
</html>
    `;
  }, [filteredReports]);

  const handleMessage = (event: any) => {
    const reportId = event.nativeEvent.data;
    if (reportId) {
      router.push(`/report-detail/${reportId}`);
    }
  };

  // Listen for iframe messages on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: any) => {
      if (e.data && e.data.type === 'report_click' && e.data.id) {
        router.push(`/report-detail/${e.data.id}`);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }
  }, [router]);

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
        <Text style={styles.title}>Carte des signalements</Text>
        <Text style={styles.subtitle}>
          {filteredReports.length} signalement{filteredReports.length > 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {STATUS_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.id}
              testID={`map-filter-${filter.id}`}
              style={[
                styles.chip,
                statusFilter === filter.id && styles.chipSelected,
              ]}
              onPress={() => setStatusFilter(filter.id)}
            >
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

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.received }]} />
          <Text style={styles.legendText}>Reçu</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.assigned }]} />
          <Text style={styles.legendText}>Assigné</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.processing }]} />
          <Text style={styles.legendText}>En cours</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.resolved }]} />
          <Text style={styles.legendText}>Résolu</Text>
        </View>
      </View>

      <View style={styles.mapContainer}>
        {filteredReports.length === 0 ? (
          <View style={styles.emptyMapContainer}>
            <Ionicons name="map-outline" size={64} color="#cbd5e1" />
            <Text style={styles.emptyText}>Aucun signalement à afficher</Text>
            <Text style={styles.emptySubtext}>
              Essayez d'autres filtres ou créez un signalement
            </Text>
          </View>
        ) : Platform.OS === 'web' ? (
          // @ts-ignore - iframe via react-native-web
          React.createElement('iframe', {
            srcDoc: mapHTML,
            style: {
              width: '100%',
              height: '100%',
              border: 'none',
              flex: 1,
              display: 'block',
            },
            sandbox: 'allow-scripts allow-same-origin',
          })
        ) : WebView ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: mapHTML }}
            onMessage={handleMessage}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
        ) : null}
      </View>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  filterContainer: {
    backgroundColor: '#ffffff',
    paddingVertical: 12,
  },
  chipRow: {
    paddingHorizontal: 24,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
    height: 36,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#64748b',
  },
  mapContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  emptyMapContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
  },
});
