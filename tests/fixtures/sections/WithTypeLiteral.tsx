// Section with inline type literal
interface Props {
  user: {
    name: string;
    email: string;
    address?: {
      city: string;
      country: string;
    };
  };
  settings: {
    theme: string;
    notifications: boolean;
  };
}

export default function WithTypeLiteral(props: Props) {
  return (
    <div>
      <span>{props.user.name}</span>
      <span>{props.settings.theme}</span>
    </div>
  );
}
