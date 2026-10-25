import { Screen } from '../components/Screen';
import { MeshHealth } from '../components/MeshHealth';

/** Route /mesh: how well the Bluetooth mesh is doing right now. */
export default function MeshHealthScreen() {
  return (
    <Screen title="Mesh health">
      <MeshHealth />
    </Screen>
  );
}
