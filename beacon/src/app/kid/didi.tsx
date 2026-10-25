import React from 'react';
import { View } from 'react-native';
import { PersonaChat } from '../../components/PersonaChat';
import { Screen } from '../../components/Screen';

export default function DidiScreen() {
  return (
    <Screen back={false} scroll={false}>
      {/* Screen already reserves the tab bar clearance on /kid/didi, so no extra bottom padding here */}
      <View style={{ flex: 1 }}>
        <PersonaChat persona="didi" />
      </View>
    </Screen>
  );
}
