// Section with special Deco types
import type { ImageWidget, RichText } from "apps/admin/widgets.ts";

interface Props {
  image: ImageWidget;
  content: RichText;
  backgroundColor?: Color;
}

type Color = string;

export default function WithSpecialTypes(props: Props) {
  return (
    <div style={{ backgroundColor: props.backgroundColor }}>
      <img src={props.image} />
      <div dangerouslySetInnerHTML={{ __html: props.content }} />
    </div>
  );
}
