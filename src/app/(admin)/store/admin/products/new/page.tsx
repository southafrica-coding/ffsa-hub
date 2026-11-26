import { redirect } from "next/navigation";
import { Masthead } from "@/components/ffsa";
import { storeAdminGuard } from "../../guard";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const { canManage } = await storeAdminGuard();
  if (!canManage) redirect("/store/admin");
  return (
    <div className="ffsa-screen">
      <Masthead context="Store · Products" title="New product" />
      <ProductForm />
    </div>
  );
}
