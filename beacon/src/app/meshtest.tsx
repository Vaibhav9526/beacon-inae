import { Screen } from '../components/Screen';
import { MeshTest } from '../components/MeshTest';

/** Route /meshtest: on-device Bluetooth mesh self-test. */
export default function MeshTestScreen() {
  return (
    <Screen title="Mesh self-test · मेश जाँच">
      <MeshTest />
    </Screen>
  );
}
