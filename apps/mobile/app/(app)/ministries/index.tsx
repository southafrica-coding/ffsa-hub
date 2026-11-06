import { MinistriesGate } from "@/features/ministries/screens/MinistriesGate";
import MinistriesListScreen from "@/features/ministries/screens/MinistriesListScreen";

export default function MinistriesRoute() {
  return (
    <MinistriesGate>
      <MinistriesListScreen />
    </MinistriesGate>
  );
}
