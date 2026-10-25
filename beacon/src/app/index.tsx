import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSettings } from '../state/settings';

export default function Index() {
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const mode = useSettings((s) => s.mode);
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: '#EAF6FF' }} />;
  if (!onboarded || !mode) return <Redirect href="/welcome" />;
  return <Redirect href={`/${mode}` as never} />;
}
