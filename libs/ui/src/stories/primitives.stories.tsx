import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlaskConicalIcon, PrinterIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Kbd,
  Label,
  NativeSelect,
  RadioGroup,
  RadioGroupItem,
  RadioGroupTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../primitives";

const meta: Meta = { title: "Primitives/Overview" };
export default meta;

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Save</Button>
      <Button variant="success">Verify</Button>
      <Button variant="critical">Critical</Button>
      <Button variant="destructive">Reject</Button>
      <Button variant="outline">
        <PrinterIcon /> Print
      </Button>
      <Button variant="secondary">
        <FlaskConicalIcon /> Order lab
      </Button>
      <Button variant="ghost">Cancel</Button>
      <Button size="sm">Small</Button>
      <Button size="xs">XS</Button>
    </div>
  ),
};

export const Badges: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["neutral", "info", "success", "warning", "danger", "critical", "teal", "outline", "default"] as const).map((v) => (
        <Badge key={v} variant={v}>
          {v}
        </Badge>
      ))}
    </div>
  ),
};

export const FormControls: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <div className="grid gap-1">
        <Label htmlFor="mrn">MRN</Label>
        <Input id="mrn" placeholder="10293" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="dept">Department</Label>
        <NativeSelect id="dept">
          <option>Hematology</option>
          <option>Chemistry</option>
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="instrument">Instrument (nothing to choose)</Label>
        <NativeSelect id="instrument" placeholder="Choose…" defaultValue="">
          {[]}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label>Priority</Label>
        <RadioGroup defaultValue="routine" className="flex gap-4">
          <Label className="font-normal">
            <RadioGroupItem value="routine" /> Routine
          </Label>
          <Label className="font-normal">
            <RadioGroupItem value="stat" /> STAT
          </Label>
        </RadioGroup>
      </div>
      <div className="grid gap-1">
        <Label>Open slots (tiles)</Label>
        <RadioGroup aria-label="Open slots" defaultValue="09:30" className="flex flex-wrap gap-1.5">
          {["09:00", "09:30", "10:00"].map((t) => (
            <RadioGroupTile key={t} value={t} className="tabular px-2.5 py-1 text-table">
              {t}
            </RadioGroupTile>
          ))}
        </RadioGroup>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" placeholder="Findings…" />
      </div>
      <p className="text-meta text-muted-foreground">
        Press <Kbd>/</Kbd> to search patients
      </p>
    </div>
  ),
};

export const PanelsAndTabs: StoryObj = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Panel</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Overview</TabsTrigger>
            <TabsTrigger value="b">Encounters</TabsTrigger>
            <TabsTrigger value="c">Labs</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Overview content</TabsContent>
          <TabsContent value="b">Encounters content</TabsContent>
          <TabsContent value="c">Labs content</TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  ),
};
