import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../src/api';
import { COLORS, SPACING, RADIUS, FONT, categoryMeta, currencySymbol } from '../src/theme';

function formatMonth(y: number, m: number) {
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const [ins, tr] = await Promise.all([api.insights(key), api.trends(6)]);
      setData(ins);
      setTrends(tr);
    } catch (e) { console.warn(e); }
  }, [year, month]);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const prev = () => { let y = year, m = month - 1; if (m < 1) { m = 12; y -= 1; } setYear(y); setMonth(m); };
  const next = () => { let y = year, m = month + 1; if (m > 12) { m = 1; y += 1; } setYear(y); setMonth(m); };

  const sym = currencySymbol(data?.currency || 'USD');
  const breakdown: any[] = data?.breakdown || [];
  const maxAmt = breakdown[0]?.amount || 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="insights-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-insights">
          <Feather name="x" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Insights</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.monthRow}>
        <Pressable onPress={prev} style={styles.navBtn} hitSlop={8} testID="prev-month">
          <Feather name="chevron-left" size={18} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.monthText}>{formatMonth(year, month)}</Text>
        <Pressable onPress={next} style={styles.navBtn} hitSlop={8} testID="next-month">
          <Feather name="chevron-right" size={18} color={COLORS.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      >
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Total spent</Text>
          <Text style={styles.summaryAmount} testID="insights-total">
            {sym}{(data?.total || 0).toFixed(2)}
          </Text>
          <Text style={styles.summaryMeta}>
            {`${data?.count || 0} transaction${(data?.count || 0) === 1 ? '' : 's'} \u2022 ${data?.currency || 'USD'}`}
          </Text>
        </View>

        {/* 6-month trend */}
        {trends?.series?.length ? (
          <View style={styles.trendCard} testID="trend-chart">
            <View style={styles.trendHeader}>
              <Text style={styles.section}>6-month trend</Text>
              <TrendDelta series={trends.series} sym={sym} />
            </View>
            <TrendBars series={trends.series} sym={sym} currentMonth={data?.month} />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
        ) : breakdown.length === 0 ? (
          <View style={styles.empty} testID="insights-empty">
            <View style={styles.emptyIcon}><Feather name="bar-chart-2" size={24} color={COLORS.brand} /></View>
            <Text style={styles.emptyTitle}>No spend this month</Text>
            <Text style={styles.emptyText}>Log expenses to see your category breakdown here.</Text>
          </View>
        ) : (
          <View style={{ gap: SPACING.md }}>
            <Text style={styles.section}>By category</Text>
            {breakdown.map(row => {
              const meta = categoryMeta(row.category);
              const width = Math.max(4, (row.amount / maxAmt) * 100);
              return (
                <View key={row.category} style={styles.catRow} testID={`cat-row-${row.category}`}>
                  <View style={styles.catHead}>
                    <View style={[styles.catIcon, { backgroundColor: meta.color + '22' }]}>
                      <Feather name={meta.icon as any} size={16} color={meta.color} />
                    </View>
                    <Text style={styles.catName}>{row.category}</Text>
                    <Text style={styles.catAmt}>{sym}{row.amount.toFixed(2)}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${width}%`, backgroundColor: meta.color }]} />
                  </View>
                  <Text style={styles.catPct}>{row.pct.toFixed(1)}%</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function TrendDelta({ series, sym }: { series: any[]; sym: string }) {
  if (series.length < 2) return null;
  const last = series[series.length - 1].total;
  const prev = series[series.length - 2].total;
  const diff = last - prev;
  const pct = prev > 0 ? (diff / prev) * 100 : (last > 0 ? 100 : 0);
  const up = diff > 0.005;
  const down = diff < -0.005;
  const color = up ? COLORS.error : (down ? COLORS.brand : COLORS.onSurfaceTertiary);
  const label = up ? 'up' : (down ? 'down' : 'flat');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="trend-delta">
      <Feather name={up ? 'trending-up' : (down ? 'trending-down' : 'minus')} size={14} color={color} />
      <Text style={{ color, fontWeight: '700', fontSize: FONT.size.sm }}>
        {`${Math.abs(pct).toFixed(0)}% ${label} vs last`}
      </Text>
    </View>
  );
}

function TrendBars({ series, sym, currentMonth }: { series: any[]; sym: string; currentMonth?: string }) {
  const max = Math.max(1, ...series.map((s: any) => s.total));
  const H = 100;
  return (
    <View>
      <View style={styles.barsRow}>
        {series.map((s: any) => {
          const h = Math.max(3, (s.total / max) * H);
          const isCurrent = s.month === currentMonth;
          return (
            <View key={s.month} style={styles.barCol} testID={`trend-bar-${s.month}`}>
              <Text style={styles.barVal}>{s.total > 0 ? `${sym}${Math.round(s.total)}` : ''}</Text>
              <View style={[styles.bar, { height: h, backgroundColor: isCurrent ? COLORS.brand : COLORS.brandSecondary }]} />
              <Text style={[styles.barLabel, isCurrent && { color: COLORS.brand, fontWeight: '700' }]}>
                {new Date(`${s.month}-01`).toLocaleDateString(undefined, { month: 'short' })}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: SPACING.sm },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface, minWidth: 160, textAlign: 'center' },
  summary: { padding: SPACING.xl, borderRadius: RADIUS.lg, backgroundColor: COLORS.brandTertiary, marginBottom: SPACING.lg },
  trendCard: { padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg, gap: SPACING.md },
  trendHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: SPACING.sm, height: 140 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  bar: { width: '100%', borderTopLeftRadius: RADIUS.sm, borderTopRightRadius: RADIUS.sm, minHeight: 3 },
  barVal: { fontSize: 10, fontWeight: '700', color: COLORS.onSurfaceSecondary },
  barLabel: { fontSize: FONT.size.sm, color: COLORS.onSurfaceTertiary, fontWeight: '600' },
  summaryLabel: { fontSize: FONT.size.base, color: COLORS.onBrandTertiary, fontWeight: '600' },
  summaryAmount: { fontSize: FONT.size.hero, fontWeight: '800', color: COLORS.brand, marginTop: SPACING.xs, letterSpacing: -1 },
  summaryMeta: { fontSize: FONT.size.base, color: COLORS.onSurfaceSecondary, marginTop: SPACING.xs },
  section: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  catRow: { gap: 6 },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  catIcon: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  catName: { flex: 1, fontSize: FONT.size.base, fontWeight: '700', color: COLORS.onSurface },
  catAmt: { fontSize: FONT.size.base, fontWeight: '700', color: COLORS.onSurface },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.surfaceSecondary, overflow: 'hidden', marginLeft: 44 },
  barFill: { height: '100%', borderRadius: 4 },
  catPct: { marginLeft: 44, fontSize: FONT.size.sm, color: COLORS.onSurfaceTertiary, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: COLORS.onSurface },
  emptyText: { fontSize: FONT.size.base, color: COLORS.onSurfaceTertiary, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xxxl },
});
