'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCategories } from '@/context/category-provider';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Check, X } from 'lucide-react';

export function CategoryManager() {
  const { toast } = useToast();
  const { categories, addCategory, updateCategory, deleteCategory } = useCategories();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await addCategory({ name: newCategoryName.trim() });
      toast({
        title: 'Categoría añadida',
        description: `Se ha creado la categoría "${newCategoryName}".`,
      });
      setNewCategoryName('');
    } catch (err) {
      console.error(err);
      toast({
        title: 'Error',
        description: 'No se pudo crear la categoría.',
        variant: 'destructive',
      });
    }
  };

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      await updateCategory({ id, name: editingName.trim() });
      toast({
        title: 'Categoría actualizada',
        description: 'La categoría se ha modificado correctamente.',
      });
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      console.error(err);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar la categoría.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Estás seguro de que deseas eliminar la categoría "${name}"? Los productos con esta categoría quedarán sin asignar.`)) {
      return;
    }

    try {
      await deleteCategory(id);
      toast({
        title: 'Categoría eliminada',
        description: `La categoría "${name}" ha sido eliminada.`,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la categoría. Asegúrese de que no esté en uso.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Category Form */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Nueva categoría..."
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          required
        />
        <Button type="submit">
          <Plus className="h-4 w-4 mr-1" />
          Añadir
        </Button>
      </form>

      {/* Categories List */}
      <div className="border rounded-md divide-y max-h-[60vh] overflow-y-auto">
        {categories.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No hay categorías creadas.
          </div>
        ) : (
          categories.map((category) => (
            <div key={category.id} className="flex items-center justify-between p-3 gap-2">
              {editingId === category.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-8"
                    required
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleSaveEdit(category.id)}
                    className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancelEdit}
                    className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-medium">{category.name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleStartEdit(category.id, category.name)}
                      className="h-8 w-8"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(category.id, category.name)}
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
